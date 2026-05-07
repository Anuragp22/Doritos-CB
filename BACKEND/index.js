import express from 'express';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';
import axios from 'axios';
import multer from 'multer';
import bcrypt from 'bcryptjs';
import cookieParser from 'cookie-parser';

import prisma from './lib/prisma.js';
import { requireAuth, signToken, cookieOptions } from './middleware/auth.js';
import { chunkText } from './lib/chunk.js';
import { embed } from './lib/embed.js';
import { extractText } from './lib/extract.js';
import { hybridRetrieve, buildAugmentedPrompt } from './lib/rag.js';

const port = process.env.PORT || 3000;
const QWEN_API_URL = process.env.QWEN_API_URL;
const QWEN_STREAM_URL = process.env.QWEN_STREAM_URL ||
  (QWEN_API_URL ? QWEN_API_URL.replace(/\/generate$/, '/generate/stream') : null);

if (!process.env.JWT_SECRET) {
  console.error('Missing JWT_SECRET in environment.');
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error('Missing DATABASE_URL in environment.');
  process.exit(1);
}
if (!QWEN_API_URL) {
  console.warn('QWEN_API_URL not set — /api/chats and /api/generate will fail.');
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

const docUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
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

  let text;
  try {
    text = await extractText(req.file);
  } catch (err) {
    return res.status(415).json({ error: err.message });
  }

  const chunks = chunkText(text);
  if (chunks.length === 0) {
    return res.status(400).json({ error: 'File contained no extractable text' });
  }

  try {
    const document = await prisma.document.create({
      data: {
        userId: req.userId,
        filename: req.file.originalname,
        contentType: req.file.mimetype || 'application/octet-stream',
      },
    });

    const embeddings = await embed(chunks);

    for (let i = 0; i < chunks.length; i++) {
      const id = randomUUID();
      const vec = `[${embeddings[i].join(',')}]`;
      await prisma.$executeRaw`
        INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", text, embedding)
        VALUES (${id}, ${document.id}, ${i}, ${chunks[i]}, ${vec}::vector)
      `;
    }

    res.status(201).json({
      id: document.id,
      filename: req.file.originalname,
      chunks: chunks.length,
    });
  } catch (err) {
    console.error('Document ingest error:', err.message);
    res.status(500).json({ error: 'Failed to ingest document' });
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

function dbMessageToQwen(message) {
  const content = [];
  if (message.imageUrl) content.push({ type: 'image', image: message.imageUrl });
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
  return prior.map(dbMessageToQwen);
}

function buildUserTurn({ augmentedText, imageUrl }) {
  const content = [];
  if (imageUrl) content.push({ type: 'image', image: imageUrl });
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

async function streamFromModel(res, messages) {
  const upstream = await axios.post(
    QWEN_STREAM_URL,
    { messages },
    { responseType: 'stream' }
  );

  return new Promise((resolve, reject) => {
    let fullText = '';
    let buffer = '';

    upstream.data.on('data', (chunk) => {
      buffer += chunk.toString();
      const events = buffer.split('\n\n');
      buffer = events.pop();
      for (const event of events) {
        if (!event.startsWith('data:')) continue;
        const payload = event.slice(5).trim();
        if (!payload) continue;
        try {
          const parsed = JSON.parse(payload);
          if (parsed.text) {
            fullText += parsed.text;
            sendSSE(res, { text: parsed.text });
          } else if (parsed.error) {
            sendSSE(res, { error: parsed.error });
          }
        } catch {
          // skip malformed line
        }
      }
    });

    upstream.data.on('end', () => resolve(fullText));
    upstream.data.on('error', reject);
  });
}

// ─── Chats ────────────────────────────────────────────────────────────

app.post('/api/chats', requireAuth, async (req, res) => {
  const { text } = req.body;
  if (!text) return res.status(400).json({ error: 'text required' });

  // Kick off chat creation and retrieval concurrently. Client gets the
  // chatId as soon as the DB returns; retrieval keeps running in parallel.
  const chatPromise = prisma.chat.create({
    data: {
      userId: req.userId,
      title: text.substring(0, 40),
      messages: { create: [{ role: 'user', text }] },
    },
    select: { id: true },
  });
  const retrievedPromise = retrieveContext(text, req.userId);

  let chat;
  try {
    chat = await chatPromise;
  } catch (err) {
    console.error('Create chat error:', err.message);
    return res.status(500).json({ error: 'Error creating chat' });
  }

  setupSSE(res);
  sendSSE(res, { chatId: chat.id });

  try {
    const retrieved = await retrievedPromise;
    const augmented = buildAugmentedPrompt(text, retrieved);

    const fullText = await streamFromModel(res, [
      buildUserTurn({ augmentedText: augmented }),
    ]);

    await prisma.message.create({
      data: { chatId: chat.id, role: 'model', text: fullText },
    });
    sendSSE(res, { done: true });
    res.end();
  } catch (err) {
    console.error('Stream chat error:', err.message);
    sendSSE(res, { error: err.message });
    res.end();
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

app.put('/api/chats/:id', requireAuth, async (req, res) => {
  const { question, img } = req.body;
  if (!question) return res.status(400).json({ error: 'question required' });

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
  const retrievedPromise = retrieveContext(question, req.userId);

  setupSSE(res);

  try {
    const [, retrieved] = await Promise.all([savePromise, retrievedPromise]);
    const augmented = buildAugmentedPrompt(question, retrieved);

    history.push(buildUserTurn({ augmentedText: augmented, imageUrl: img || null }));

    const fullText = await streamFromModel(res, history);

    await prisma.message.create({
      data: { chatId: chat.id, role: 'model', text: fullText },
    });
    sendSSE(res, { done: true });
    res.end();
  } catch (err) {
    console.error('Stream chat error:', err.message);
    sendSSE(res, { error: err.message });
    res.end();
  }
});

app.post('/api/generate', requireAuth, async (req, res) => {
  try {
    const { user_text, image_url } = req.body;
    if (!user_text && !image_url) {
      return res.status(400).json({ error: 'Either user_text or image_url must be provided.' });
    }
    const payload = {};
    if (user_text) payload.user_text = user_text;
    if (image_url) payload.image_url = image_url;

    const response = await axios.post(QWEN_API_URL, payload, {
      headers: { 'Content-Type': 'application/json' },
    });
    res.status(200).json(response.data);
  } catch (err) {
    console.error('Error in /api/generate:', err.message);
    const status = err.response?.status || 500;
    const errorData = err.response?.data || { error: 'Internal Server Error' };
    res.status(status).json(errorData);
  }
});

// ─── Error handler ────────────────────────────────────────────────────

app.use((err, req, res, next) => {
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
  app.listen(port, () => console.log(`Server running on ${port}`));
};

start();
