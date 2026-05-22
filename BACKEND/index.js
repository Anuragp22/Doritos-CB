import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';

import prisma from './lib/prisma.js';
import { requireAuth, signToken, cookieOptions } from './middleware/auth.js';
import { pruneHistory } from './lib/history.js';
import { hybridRetrieve, buildAugmentedPrompt } from './lib/rag.js';
import { streamChat, generateOnce } from './lib/ollama.js';
import { streamAgent } from './lib/agent.js';
import { streamVisionAnswer } from './lib/gemini.js';
import { enqueueIngest } from './lib/ingest.js';
import { segmentEnabled, cutoutFilename, decodeBase64Png } from './lib/segment.js';

const port = process.env.PORT || 3000;
const MAX_UPLOAD_MB = 500;

if (!process.env.JWT_SECRET) {
  console.error('Missing JWT_SECRET in environment.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL in environment.');
  process.exit(1);
}
if (!process.env.OLLAMA_URL) {
  console.warn('OLLAMA_URL not set — /api/chats and /api/generate will fail.');
}

const app = express();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(
  cors({
    origin: process.env.CLIENT_URL,
    credentials: true,
  })
);
app.use(express.json());
app.use(cookieParser());

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, 'uploads'));
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(
      null,
      `${file.fieldname}-${uniqueSuffix}${path.extname(file.originalname)}`
    );
  },
});
const upload = multer({ storage });

app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Document uploads stream to a temp dir on disk (not held in RAM) and are
// deleted once the background ingest job finishes with them.
const TMP_DIR = path.join(__dirname, 'tmp');
const docUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, TMP_DIR),
    filename: (req, file, cb) =>
      cb(null, `${randomUUID()}${path.extname(file.originalname)}`),
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

// ─── Auth ─────────────────────────────────────────────────────────────

app.post('/api/auth/register', async (req, res) => {
  const { email, username, password } = req.body || {};
  if (!email || !username || !password) {
    return res.status(400).json({ error: 'email, username, password required' });
  }
  if (password.length < 6) {
    return res.status(400).json({ error: 'Password must be at least 6 characters' });
  }
  try {
    const normalizedEmail = email.toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email: normalizedEmail } });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: { email: normalizedEmail, username, password: hash },
      select: { id: true, email: true, username: true },
    });

    const token = signToken(user.id);
    res.cookie('token', token, cookieOptions());
    res.status(201).json(user);
  } catch (err) {
    console.error('Register error:', err);
    res.status(500).json({ error: 'Registration failed' });
  }
});

app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password required' });
  }
  try {
    const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });

    const token = signToken(user.id);
    res.cookie('token', token, cookieOptions());
    res.json({ id: user.id, email: user.email, username: user.username });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Login failed' });
  }
});

app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token', { ...cookieOptions(), maxAge: undefined });
  res.json({ ok: true });
});

app.get('/api/auth/me', requireAuth, async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.userId },
    select: { id: true, email: true, username: true },
  });
  if (!user) return res.status(401).json({ error: 'Unauthenticated' });
  res.json(user);
});

// ─── Uploads ──────────────────────────────────────────────────────────

app.post('/upload', requireAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
  const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ fileUrl });
});

// ─── Documents (RAG) ──────────────────────────────────────────────────

app.post('/api/documents', requireAuth, docUpload.single('file'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  try {
    const document = await prisma.document.create({
      data: {
        userId: req.userId,
        filename: req.file.originalname,
        contentType: req.file.mimetype || 'application/octet-stream',
        status: 'processing',
      },
    });

    // Hand off to the background processor; do not await — the upload
    // request returns immediately.
    enqueueIngest({
      documentId: document.id,
      filePath: req.file.path,
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      userId: req.userId,
    });

    res.status(202).json({
      id: document.id,
      filename: document.filename,
      status: 'processing',
    });
  } catch (err) {
    console.error('Document upload error:', err.message);
    await fs.unlink(req.file.path).catch(() => {});
    res.status(500).json({ error: 'Failed to accept document' });
  }
});

app.get('/api/documents', requireAuth, async (req, res) => {
  try {
    const docs = await prisma.document.findMany({
      where: { userId: req.userId },
      select: {
        id: true,
        filename: true,
        contentType: true,
        status: true,
        error: true,
        createdAt: true,
        _count: { select: { chunks: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(
      docs.map((d) => ({
        id: d.id,
        filename: d.filename,
        contentType: d.contentType,
        status: d.status,
        error: d.error,
        createdAt: d.createdAt,
        chunkCount: d._count.chunks,
      }))
    );
  } catch (err) {
    console.error('Fetch documents error:', err);
    res.status(500).json({ error: 'Error fetching documents' });
  }
});

app.delete('/api/documents/:id', requireAuth, async (req, res) => {
  try {
    const result = await prisma.document.deleteMany({
      where: { id: req.params.id, userId: req.userId },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Document not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete document error:', err);
    res.status(500).json({ error: 'Error deleting document' });
  }
});

async function retrieveContext(query, userId) {
  try {
    return await hybridRetrieve(query, userId);
  } catch (err) {
    console.error('RAG retrieval failed (continuing without context):', err.message);
    return [];
  }
}

// Convert a stored upload URL (or any URL) into a payload the model can fetch
// without reaching back into our network. Local /uploads/* paths get read from
// disk and inlined as a base64 data URI so a remote model host (e.g. Modal)
// receives the bytes directly. External URLs and existing data URIs pass
// through unchanged.
const MIME_BY_EXT = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

async function imageUrlToInline(url) {
  if (!url) return null;
  if (url.startsWith('data:')) return url;
  const idx = url.indexOf('/uploads/');
  if (idx === -1) return url;
  const filename = url.slice(idx + '/uploads/'.length).split(/[?#]/)[0];
  const filePath = path.join(__dirname, 'uploads', filename);
  try {
    const bytes = await fs.readFile(filePath);
    const ext = path.extname(filename).toLowerCase().slice(1);
    const mime = MIME_BY_EXT[ext] || 'application/octet-stream';
    return `data:${mime};base64,${bytes.toString('base64')}`;
  } catch (err) {
    console.error(`Failed to inline upload ${filename}:`, err.message);
    return url;
  }
}

async function dbMessageToQwen(message) {
  const content = [];
  if (message.imageUrl) {
    const inline = await imageUrlToInline(message.imageUrl);
    if (inline) content.push({ type: 'image', image: inline });
  }
  content.push({ type: 'text', text: message.text });
  return {
    role: message.role === 'model' ? 'assistant' : 'user',
    content,
  };
}

async function loadHistoryMessages(chatId) {
  if (!chatId) return [];
  const prior = await prisma.message.findMany({
    where: { chatId },
    orderBy: { createdAt: 'asc' },
  });
  return Promise.all(prior.map(dbMessageToQwen));
}

async function buildUserTurn({ augmentedText, imageUrl }) {
  const content = [];
  if (imageUrl) {
    const inline = await imageUrlToInline(imageUrl);
    if (inline) content.push({ type: 'image', image: inline });
  }
  content.push({ type: 'text', text: augmentedText });
  return { role: 'user', content };
}

function setupSSE(res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

function sendSSE(res, data) {
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

async function streamFromModel(res, messages, req) {
  const controller = new AbortController();
  let aborted = false;
  let fullText = '';

  const onClose = () => {
    if (!aborted) {
      aborted = true;
      controller.abort();
    }
  };
  req.on('close', onClose);

  try {
    for await (const delta of streamChat(messages, { signal: controller.signal })) {
      fullText += delta;
      if (!aborted) sendSSE(res, { text: delta });
    }
    return { fullText, aborted };
  } catch (err) {
    if (aborted) return { fullText, aborted: true };
    throw err;
  } finally {
    req.off('close', onClose);
  }
}

// Agentic mode: consume the LangGraph agent stream, mapping its normalized
// events (step / sources / text) to SSE. Returns the assembled answer +
// the sources the agent's search tool retrieved.
async function streamFromAgent(res, messages, req, userId) {
  const controller = new AbortController();
  let aborted = false;
  let fullText = '';
  let sources = null;

  const onClose = () => {
    if (!aborted) {
      aborted = true;
      controller.abort();
    }
  };
  req.on('close', onClose);

  try {
    for await (const ev of streamAgent(messages, { userId, signal: controller.signal })) {
      if (aborted) break;
      if (ev.kind === 'text') {
        fullText += ev.text;
        sendSSE(res, { text: ev.text });
      } else if (ev.kind === 'thinking') {
        sendSSE(res, { thinking: ev.text });
      } else if (ev.kind === 'step') {
        sendSSE(res, { step: { tool: ev.tool, phase: ev.phase, query: ev.query } });
      } else if (ev.kind === 'sources') {
        sources = toSourcesPayload(ev.chunks);
        if (sources) sendSSE(res, { sources });
      }
    }
    return { fullText, aborted, sources };
  } catch (err) {
    if (aborted) return { fullText, aborted: true, sources };
    throw err;
  } finally {
    req.off('close', onClose);
  }
}

// Image chat: stream a Gemini answer for a turn that carries an image.
async function streamFromGemini(res, messages, req) {
  const controller = new AbortController();
  let aborted = false;
  let fullText = '';

  const onClose = () => {
    if (!aborted) {
      aborted = true;
      controller.abort();
    }
  };
  req.on('close', onClose);

  try {
    for await (const delta of streamVisionAnswer(messages, { signal: controller.signal })) {
      fullText += delta;
      if (!aborted) sendSSE(res, { text: delta });
    }
    return { fullText, aborted };
  } catch (err) {
    if (aborted) return { fullText, aborted: true };
    throw err;
  } finally {
    req.off('close', onClose);
  }
}

function toSourcesPayload(retrievedChunks) {
  if (!retrievedChunks?.length) return null;
  return retrievedChunks.map((c, i) => ({
    index: i + 1,
    documentId: c.documentId,
    filename: c.filename,
    snippet: typeof c.text === 'string' ? c.text.slice(0, 600) : '',
    score: typeof c.score === 'number' ? c.score : null,
  }));
}

async function persistAssistantMessage(chatId, text, sources) {
  if (!text) return;
  try {
    await prisma.message.create({
      data: { chatId, role: 'model', text, sources: sources ?? undefined },
    });
  } catch (err) {
    console.error('Persist assistant message error:', err.message);
  }
}

// ─── Chats ────────────────────────────────────────────────────────────

app.post('/api/chats', requireAuth, async (req, res) => {
  // Create the chat row only. The first turn is sent from the chat page (via
  // PUT) so the answer streams there, not on the landing page.
  const text = (req.body.text || '').trim();
  try {
    const chat = await prisma.chat.create({
      data: {
        userId: req.userId,
        title: (text || 'New chat').substring(0, 40),
      },
      select: { id: true },
    });
    res.json({ chatId: chat.id });
  } catch (err) {
    console.error('Create chat error:', err.message);
    res.status(500).json({ error: 'Error creating chat' });
  }
});

app.get('/api/userchats', requireAuth, async (req, res) => {
  try {
    const chats = await prisma.chat.findMany({
      where: { userId: req.userId },
      select: { id: true, title: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
    });
    res.json(chats);
  } catch (err) {
    console.error('Fetch userchats error:', err);
    res.status(500).json({ error: 'Error fetching userchats' });
  }
});

app.get('/api/chats/:id', requireAuth, async (req, res) => {
  try {
    const chat = await prisma.chat.findFirst({
      where: { id: req.params.id, userId: req.userId },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    });
    if (!chat) return res.status(404).json({ error: 'Chat not found' });
    res.json(chat);
  } catch (err) {
    console.error('Fetch chat error:', err);
    res.status(500).json({ error: 'Error fetching chat' });
  }
});

app.patch('/api/chats/:id', requireAuth, async (req, res) => {
  const title = (req.body.title || '').trim();
  if (!title) return res.status(400).json({ error: 'title required' });
  try {
    const result = await prisma.chat.updateMany({
      where: { id: req.params.id, userId: req.userId },
      data: { title: title.slice(0, 80) },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Chat not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Rename chat error:', err.message);
    res.status(500).json({ error: 'Error renaming chat' });
  }
});

app.delete('/api/chats/:id', requireAuth, async (req, res) => {
  try {
    // Messages cascade-delete with the chat (schema: Message.onDelete Cascade).
    const result = await prisma.chat.deleteMany({
      where: { id: req.params.id, userId: req.userId },
    });
    if (result.count === 0) return res.status(404).json({ error: 'Chat not found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('Delete chat error:', err.message);
    res.status(500).json({ error: 'Error deleting chat' });
  }
});

app.put('/api/chats/:id', requireAuth, async (req, res) => {
  const { question, img, mode } = req.body;
  // A turn needs text, an image, or both — an image alone is allowed.
  if (!question && !img) {
    return res.status(400).json({ error: 'question or image required' });
  }
  const agentic = mode === 'agentic';

  const chat = await prisma.chat.findFirst({
    where: { id: req.params.id, userId: req.userId },
    select: { id: true },
  });
  if (!chat) return res.status(404).json({ error: 'Chat not found' });

  // Load history (excluding the new turn) sequentially; this is fast and we
  // need a stable view that does not race with the user-message insert.
  let history;
  try {
    history = await loadHistoryMessages(chat.id);
  } catch (err) {
    console.error('Load history error:', err.message);
    return res.status(500).json({ error: 'Error loading chat history' });
  }

  // Save the new user message and run retrieval in parallel — the slow
  // operations both block the model call but are independent of each other.
  const savePromise = prisma.message.create({
    data: { chatId: chat.id, role: 'user', text: question, imageUrl: img || null },
  });
  const retrievedPromise = agentic || img ? null : retrieveContext(question, req.userId);

  setupSSE(res);

  try {
    let result;
    if (img) {
      // Image turns go to Gemini — a fast multimodal model. The Groq agent is
      // text-only; the offline model is vision-capable but slow on CPU.
      await savePromise;
      history.push(await buildUserTurn({ augmentedText: question, imageUrl: img }));
      result = await streamFromGemini(res, pruneHistory(history), req);
      await persistAssistantMessage(chat.id, result.fullText, null);
    } else if (agentic) {
      await savePromise;
      history.push(await buildUserTurn({ augmentedText: question, imageUrl: img || null }));
      result = await streamFromAgent(res, pruneHistory(history), req, req.userId);
      await persistAssistantMessage(chat.id, result.fullText, result.sources);
    } else {
      const [, retrieved] = await Promise.all([savePromise, retrievedPromise]);
      const sources = toSourcesPayload(retrieved);
      if (sources) sendSSE(res, { sources });
      const augmented = buildAugmentedPrompt(question, retrieved);
      history.push(await buildUserTurn({ augmentedText: augmented, imageUrl: img || null }));
      result = await streamFromModel(res, pruneHistory(history), req);
      await persistAssistantMessage(chat.id, result.fullText, sources);
    }

    if (!result.aborted) {
      sendSSE(res, { done: true });
      res.end();
    }
  } catch (err) {
    console.error('Stream chat error:', err.message);
    if (!res.writableEnded) {
      sendSSE(res, { error: err.message });
      res.end();
    }
  }
});

app.post('/api/generate', requireAuth, async (req, res) => {
  try {
    const { user_text, image_url } = req.body;
    if (!user_text && !image_url) {
      return res.status(400).json({ error: 'Either user_text or image_url must be provided.' });
    }
    const inlineImage = image_url ? await imageUrlToInline(image_url) : undefined;
    const description = await generateOnce({ user_text, image_url: inlineImage });
    res.status(200).json({ description });
  } catch (err) {
    console.error('Error in /api/generate:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ─── SAM2 segmentation ────────────────────────────────────────────────
// Proxies to the SAM2 Modal GPU deployment. When SEGMENT_API_URL is unset the
// feature reports disabled and the client hides the "Select object" button.

async function callSegment(endpointPath, body) {
  const base = process.env.SEGMENT_API_URL.replace(/\/$/, '');
  const response = await fetch(`${base}${endpointPath}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${process.env.MODEL_API_KEY || ''}`,
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`Segmentation service ${response.status}: ${detail.slice(0, 200)}`);
  }
  return response.json();
}

// Resolve a /uploads/* URL to an inlined data: URI, or null if it cannot.
async function inlineUploadOrNull(imageUrl) {
  if (!imageUrl) return null;
  const inline = await imageUrlToInline(imageUrl);
  return inline && inline.startsWith('data:') ? inline : null;
}

app.get('/api/segment/status', requireAuth, (req, res) => {
  res.json({ enabled: segmentEnabled() });
});

app.post('/api/segment/warmup', requireAuth, async (req, res) => {
  if (!segmentEnabled()) {
    return res.status(503).json({ error: 'Segmentation is not configured' });
  }
  const base = process.env.SEGMENT_API_URL.replace(/\/$/, '');
  try {
    // GET / answers only once the Modal container is booted and SAM2 is
    // loaded, so awaiting it is a genuine "GPU ready" signal. The long timeout
    // covers a full cold start; the client shows a spinner until this resolves.
    const probe = await fetch(`${base}/`, { signal: AbortSignal.timeout(90000) });
    res.json({ ready: probe.ok });
  } catch {
    res.json({ ready: false });
  }
});

app.post('/api/segment/predict', requireAuth, async (req, res) => {
  if (!segmentEnabled()) {
    return res.status(503).json({ error: 'Segmentation is not configured' });
  }
  try {
    const { imageUrl, points = [], labels = [], box = null } = req.body;
    const inline = await inlineUploadOrNull(imageUrl);
    if (!inline) {
      return res.status(400).json({ error: 'imageUrl did not resolve to an image' });
    }
    const result = await callSegment('/segment/predict', {
      image_b64: inline, points, labels, box,
    });
    res.json(result);
  } catch (err) {
    console.error('Segment predict error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

app.post('/api/segment/apply', requireAuth, async (req, res) => {
  if (!segmentEnabled()) {
    return res.status(503).json({ error: 'Segmentation is not configured' });
  }
  try {
    const { imageUrl, points = [], labels = [], box = null } = req.body;
    const inline = await inlineUploadOrNull(imageUrl);
    if (!inline) {
      return res.status(400).json({ error: 'imageUrl did not resolve to an image' });
    }
    const { cutout_png } = await callSegment('/segment/apply', {
      image_b64: inline, points, labels, box,
    });
    const filename = cutoutFilename(imageUrl);
    await fs.writeFile(
      path.join(__dirname, 'uploads', filename),
      decodeBase64Png(cutout_png),
    );
    const fileUrl = `${req.protocol}://${req.get('host')}/uploads/${filename}`;
    res.json({ fileUrl });
  } catch (err) {
    console.error('Segment apply error:', err.message);
    res.status(502).json({ error: err.message });
  }
});

// ─── Error handler ────────────────────────────────────────────────────

app.use((err, req, res, next) => {
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') {
    return res
      .status(413)
      .json({ error: `File exceeds the ${MAX_UPLOAD_MB} MB limit` });
  }
  console.error(err.stack);
  res.status(500).json({ error: 'Internal server error' });
});

const start = async () => {
  try {
    await prisma.$connect();
    console.log('Connected to PostgreSQL');
  } catch (error) {
    console.error('Database connection failed:', error.message);
    process.exit(1);
  }

  await fs.mkdir(TMP_DIR, { recursive: true });

  // A document left mid-ingest by a crash/restart cannot resume — its in-memory
  // job is gone. Drop any partial chunks it wrote and mark it failed, so the
  // user can re-upload rather than it being stuck on "processing".
  try {
    await prisma.documentChunk.deleteMany({
      where: { document: { status: 'processing' } },
    });
    const interrupted = await prisma.document.updateMany({
      where: { status: 'processing' },
      data: { status: 'failed', error: 'Processing interrupted by a server restart.' },
    });
    if (interrupted.count > 0) {
      console.log(
        `Marked ${interrupted.count} interrupted document(s) as failed — re-upload to retry.`
      );
    }
  } catch (err) {
    console.error('Startup recovery failed:', err.message);
  }

  app.listen(port, () => console.log(`Server running on ${port}`));
};

start();
