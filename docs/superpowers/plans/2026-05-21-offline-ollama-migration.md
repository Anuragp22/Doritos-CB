# Offline Ollama Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move generation off Modal/GPU to a local Ollama service so the whole app runs offline on CPU.

**Architecture:** Generation runs on a local `ollama` Docker service (`qwen3.5:2b`, multimodal). Embeddings and reranking stay on `MODEL/server.py` running in a new CPU-only mode that skips loading the VLM. The backend gets a thin `ollama.js` adapter; the Modal/GPU files stay in the repo, dormant.

**Tech Stack:** Node.js/Express (ESM), Ollama, FastAPI (`server.py`), Docker Compose, `node:test` (stdlib test runner).

---

## File Structure

- **Create** `BACKEND/lib/ollama.js` — adapter: internal-message → Ollama conversion, streaming + non-streaming chat.
- **Create** `BACKEND/lib/ollama.test.js` — unit tests for the pure conversion function.
- **Modify** `BACKEND/package.json` — wire up the `test` script.
- **Modify** `BACKEND/index.js` — route generation through `ollama.js`; drop the dead `QWEN_*` / `modelClient` wiring.
- **Modify** `MODEL/server.py` — add the `ENABLE_GENERATION` flag.
- **Modify** `docker-compose.yml` — add `ollama` + `ollama-pull` services; switch `model` to CPU embed/rerank-only, default-on.
- **Modify** `.env.example`, `BACKEND/.env.example` — document the offline env.
- **Modify** `MODEL/README.md` — document the offline run path.

`embed.js` / `rerank.js` are **not** touched — they keep hitting `server.py` unchanged.

**Testing note:** the project has no test framework. This plan adds the Node stdlib runner (`node --test`, zero new dependencies) and unit-tests the one pure function (`toOllamaMessages`). The HTTP/streaming functions and all infra changes are verified by the end-to-end run in Task 6.

---

## Task 1: Backend Ollama adapter + unit tests

**Files:**
- Modify: `BACKEND/package.json`
- Test: `BACKEND/lib/ollama.test.js`
- Create: `BACKEND/lib/ollama.js`

- [ ] **Step 1: Wire up the test script**

In `BACKEND/package.json`, replace this line:

```json
    "test": "echo \"Error: no test specified\" && exit 1"
```

with:

```json
    "test": "node --test"
```

- [ ] **Step 2: Write the failing tests**

Create `BACKEND/lib/ollama.test.js`:

```js
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toOllamaMessages } from './ollama.js';

test('toOllamaMessages: text-only user message', () => {
  const out = toOllamaMessages([
    { role: 'user', content: [{ type: 'text', text: 'hello' }] },
  ]);
  assert.deepEqual(out, [{ role: 'user', content: 'hello' }]);
});

test('toOllamaMessages: maps legacy "model" role to "assistant"', () => {
  const out = toOllamaMessages([
    { role: 'model', content: [{ type: 'text', text: 'hi there' }] },
  ]);
  assert.equal(out[0].role, 'assistant');
  assert.equal(out[0].content, 'hi there');
});

test('toOllamaMessages: extracts image and strips the data URI prefix', () => {
  const out = toOllamaMessages([
    {
      role: 'user',
      content: [
        { type: 'image', image: 'data:image/png;base64,QUJD' },
        { type: 'text', text: 'describe this' },
      ],
    },
  ]);
  assert.deepEqual(out, [
    { role: 'user', content: 'describe this', images: ['QUJD'] },
  ]);
});

test('toOllamaMessages: joins multiple text parts with newlines', () => {
  const out = toOllamaMessages([
    {
      role: 'user',
      content: [
        { type: 'text', text: 'line one' },
        { type: 'text', text: 'line two' },
      ],
    },
  ]);
  assert.equal(out[0].content, 'line one\nline two');
});

test('toOllamaMessages: omits images field when there are no images', () => {
  const out = toOllamaMessages([
    { role: 'user', content: [{ type: 'text', text: 'no pics' }] },
  ]);
  assert.equal('images' in out[0], false);
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run (from `BACKEND/`): `npm test`
Expected: FAIL — `Cannot find module './ollama.js'`.

- [ ] **Step 4: Implement the adapter**

Create `BACKEND/lib/ollama.js`:

```js
import axios from 'axios';

// Adapter for a local Ollama service. Generation (text + vision) runs here;
// embeddings/reranking stay on MODEL/server.py and are not handled in this file.
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const GEN_MODEL = process.env.GEN_MODEL || 'qwen3.5:2b';

// Convert the backend's internal message format
//   { role, content: [{ type: 'text', text }, { type: 'image', image }] }
// into Ollama's /api/chat shape
//   { role, content: <joined text>, images?: [<base64>] }
export function toOllamaMessages(messages) {
  return messages.map((m) => {
    const role = m.role === 'model' ? 'assistant' : m.role;
    const parts = Array.isArray(m.content)
      ? m.content
      : [{ type: 'text', text: String(m.content ?? '') }];
    const content = parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text || '')
      .join('\n');
    const images = parts
      .filter((p) => p.type === 'image' && p.image)
      .map((p) => p.image.replace(/^data:[^;]+;base64,/, ''));
    const msg = { role, content };
    if (images.length) msg.images = images;
    return msg;
  });
}

// Stream a chat completion. Async generator yielding text deltas.
export async function* streamChat(messages, { signal } = {}) {
  const resp = await axios.post(
    `${OLLAMA_URL}/api/chat`,
    { model: GEN_MODEL, messages: toOllamaMessages(messages), stream: true },
    { responseType: 'stream', signal }
  );

  let buffer = '';
  for await (const chunk of resp.data) {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (parsed.error) throw new Error(parsed.error);
      const delta = parsed.message?.content;
      if (delta) yield delta;
    }
  }
}

// Non-streaming single-shot generation. Returns the full text.
export async function generateOnce({ user_text, image_url }) {
  const content = [];
  if (image_url) content.push({ type: 'image', image: image_url });
  if (user_text) content.push({ type: 'text', text: user_text });
  const { data } = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: GEN_MODEL,
    messages: toOllamaMessages([{ role: 'user', content }]),
    stream: false,
  });
  return data.message?.content ?? '';
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `BACKEND/`): `npm test`
Expected: PASS — 5 tests passing.

- [ ] **Step 6: Commit**

```bash
git add BACKEND/package.json BACKEND/lib/ollama.js BACKEND/lib/ollama.test.js
git commit -m "feat(backend): add Ollama adapter for local generation"
git push
```

---

## Task 2: server.py — ENABLE_GENERATION flag

**Files:**
- Modify: `MODEL/server.py`

- [ ] **Step 1: Add the env flag**

In `MODEL/server.py`, find:

```python
RERANK_MODEL_ID = os.getenv("RERANK_MODEL_ID", "BAAI/bge-reranker-base")
HOST = os.getenv("HOST", "127.0.0.1")
```

Replace with:

```python
RERANK_MODEL_ID = os.getenv("RERANK_MODEL_ID", "BAAI/bge-reranker-base")
ENABLE_GENERATION = os.getenv("ENABLE_GENERATION", "true").lower() == "true"
HOST = os.getenv("HOST", "127.0.0.1")
```

- [ ] **Step 2: Gate the VLM load in the lifespan handler**

Find:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        _load_vlm(DEFAULT_MODEL_ID)
    except Exception as exc:
        print(f"VLM load failed; /generate will return 503. Reason: {exc}")
    try:
```

Replace with:

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    if ENABLE_GENERATION:
        try:
            _load_vlm(DEFAULT_MODEL_ID)
        except Exception as exc:
            print(f"VLM load failed; /generate will return 503. Reason: {exc}")
    else:
        print("ENABLE_GENERATION=false — skipping VLM load (embed/rerank only).")
    try:
```

- [ ] **Step 3: Document the flag in the module docstring**

Find:

```python
    RERANK_MODEL_ID  Embedding model repo id (default: BAAI/bge-small-en-v1.5; 384 dims).
```

(If the docstring lists env vars differently, find the `EMBED_MODEL_ID` line and add the new line after the env-var list.) Add this line to the env-vars section of the docstring:

```python
    ENABLE_GENERATION  Set to "false" to skip loading the VLM and serve only
                       /embed and /rerank on CPU (default: "true").
```

- [ ] **Step 4: Verify the file still parses**

Run (from `MODEL/`): `python -c "import ast; ast.parse(open('server.py').read()); print('OK')"`
Expected: `OK`

- [ ] **Step 5: Commit**

```bash
git add MODEL/server.py
git commit -m "feat(model): add ENABLE_GENERATION flag for CPU embed/rerank-only mode"
git push
```

---

## Task 3: index.js — route generation through Ollama

**Files:**
- Modify: `BACKEND/index.js`

- [ ] **Step 1: Swap the import**

Find:

```js
import { hybridRetrieve, buildAugmentedPrompt } from './lib/rag.js';
import { modelClient } from './lib/modelClient.js';
```

Replace with:

```js
import { hybridRetrieve, buildAugmentedPrompt } from './lib/rag.js';
import { streamChat, generateOnce } from './lib/ollama.js';
```

- [ ] **Step 2: Remove the dead QWEN_* constants**

Find:

```js
const port = process.env.PORT || 3000;
const QWEN_API_URL = process.env.QWEN_API_URL;
const QWEN_STREAM_URL = process.env.QWEN_STREAM_URL ||
  (QWEN_API_URL ? QWEN_API_URL.replace(/\/generate$/, '/generate/stream') : null);
```

Replace with:

```js
const port = process.env.PORT || 3000;
```

- [ ] **Step 3: Update the startup guard**

Find:

```js
if (!QWEN_API_URL) {
  console.warn('QWEN_API_URL not set — /api/chats and /api/generate will fail.');
}
```

Replace with:

```js
if (!process.env.OLLAMA_URL) {
  console.warn('OLLAMA_URL not set — /api/chats and /api/generate will fail.');
}
```

- [ ] **Step 4: Rewrite `streamFromModel`**

Find the entire `streamFromModel` function:

```js
async function streamFromModel(res, messages, req) {
  const controller = new AbortController();
  let aborted = false;

  const onClose = () => {
    if (!aborted) {
      aborted = true;
      controller.abort();
    }
  };
  req.on('close', onClose);

  try {
    const upstream = await modelClient.post(
      QWEN_STREAM_URL,
      { messages },
      { responseType: 'stream', signal: controller.signal }
    );

    return await new Promise((resolve, reject) => {
      let fullText = '';
      let buffer = '';

      upstream.data.on('data', (chunk) => {
        buffer += chunk.toString();
        const events = buffer.split('\n\n');
        buffer = events.pop() || '';
        for (const event of events) {
          if (!event.startsWith('data:')) continue;
          const payload = event.slice(5).trim();
          if (!payload) continue;
          try {
            const parsed = JSON.parse(payload);
            if (parsed.text) {
              fullText += parsed.text;
              if (!aborted) sendSSE(res, { text: parsed.text });
            } else if (parsed.error && !aborted) {
              sendSSE(res, { error: parsed.error });
            }
          } catch {
            // skip malformed line
          }
        }
      });

      upstream.data.on('end', () => resolve({ fullText, aborted }));
      upstream.data.on('error', (err) => {
        if (aborted) resolve({ fullText, aborted });
        else reject(err);
      });
    });
  } catch (err) {
    if (aborted) return { fullText: '', aborted: true };
    throw err;
  } finally {
    req.off('close', onClose);
  }
}
```

Replace with:

```js
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
```

- [ ] **Step 5: Rewrite `/api/generate`**

Find the entire `/api/generate` route:

```js
app.post('/api/generate', requireAuth, async (req, res) => {
  try {
    const { user_text, image_url } = req.body;
    if (!user_text && !image_url) {
      return res.status(400).json({ error: 'Either user_text or image_url must be provided.' });
    }
    const payload = {};
    if (user_text) payload.user_text = user_text;
    if (image_url) payload.image_url = await imageUrlToInline(image_url);

    const response = await modelClient.post(QWEN_API_URL, payload, {
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
```

Replace with:

```js
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
```

- [ ] **Step 6: Verify the file still parses**

Run (from `BACKEND/`): `node --check index.js`
Expected: no output, exit code 0.

- [ ] **Step 7: Commit**

```bash
git add BACKEND/index.js
git commit -m "feat(backend): stream chat + generate through the Ollama adapter"
git push
```

---

## Task 4: docker-compose.yml — Ollama services + CPU model service

**Files:**
- Modify: `docker-compose.yml`

- [ ] **Step 1: Add OLLAMA_URL + GEN_MODEL to the backend, drop QWEN_API_URL, repoint embed/rerank**

In the `backend` service `environment:` block, find:

```yaml
      QWEN_API_URL: ${QWEN_API_URL:-http://host.docker.internal:5000/generate}
      EMBED_API_URL: ${EMBED_API_URL:-http://host.docker.internal:5000/embed}
      RERANK_API_URL: ${RERANK_API_URL:-http://host.docker.internal:5000/rerank}
      MODEL_API_KEY: ${MODEL_API_KEY:-}
```

Replace with:

```yaml
      OLLAMA_URL: ${OLLAMA_URL:-http://ollama:11434}
      GEN_MODEL: ${GEN_MODEL:-qwen3.5:2b}
      EMBED_API_URL: ${EMBED_API_URL:-http://model:5000/embed}
      RERANK_API_URL: ${RERANK_API_URL:-http://model:5000/rerank}
      MODEL_API_KEY: ${MODEL_API_KEY:-}
```

- [ ] **Step 2: Make the backend wait for ollama + model**

In the `backend` service, find:

```yaml
    depends_on:
      postgres:
        condition: service_healthy
```

Replace with:

```yaml
    depends_on:
      postgres:
        condition: service_healthy
      model:
        condition: service_started
      ollama:
        condition: service_healthy
```

- [ ] **Step 3: Switch the `model` service to default-on CPU embed/rerank**

In the `model` service, find:

```yaml
    environment:
      HOST: 0.0.0.0
      PORT: 5000
      MODEL_ID: ${MODEL_ID:-Qwen/Qwen2-VL-2B-Instruct}
      HF_HOME: /root/.cache/huggingface
    ports:
      - "5000:5000"
    profiles:
      - model
    volumes:
```

Replace with (this removes the `profiles:` block so the service runs by default, and adds the flag):

```yaml
    environment:
      HOST: 0.0.0.0
      PORT: 5000
      MODEL_ID: ${MODEL_ID:-Qwen/Qwen2-VL-2B-Instruct}
      ENABLE_GENERATION: "false"
      HF_HOME: /root/.cache/huggingface
    ports:
      - "5000:5000"
    volumes:
```

- [ ] **Step 4: Add the `ollama` and `ollama-pull` services**

Insert these two services into the `services:` block, immediately before the `model:` service:

```yaml
  # Local generation runtime. Serves the multimodal chat model on CPU.
  ollama:
    image: ollama/ollama
    ports:
      - "11434:11434"
    volumes:
      - ollama_data:/root/.ollama
    healthcheck:
      test: ["CMD", "ollama", "list"]
      interval: 5s
      timeout: 10s
      retries: 20

  # One-shot: pulls GEN_MODEL into the ollama service on startup. Falls back to
  # `ollama show` so an offline restart (model already cached) still exits 0.
  ollama-pull:
    image: ollama/ollama
    depends_on:
      ollama:
        condition: service_healthy
    environment:
      OLLAMA_HOST: http://ollama:11434
    entrypoint:
      - /bin/sh
      - -c
      - ollama pull "${GEN_MODEL:-qwen3.5:2b}" || ollama show "${GEN_MODEL:-qwen3.5:2b}"
    restart: "no"

```

- [ ] **Step 5: Add the `ollama_data` volume**

Find the `volumes:` block at the bottom:

```yaml
volumes:
  postgres_data:
  backend_uploads:
  huggingface_cache:
  model_checkpoints:
```

Replace with:

```yaml
volumes:
  postgres_data:
  backend_uploads:
  huggingface_cache:
  model_checkpoints:
  ollama_data:
```

- [ ] **Step 6: Verify the compose file is valid**

Run (from the repo root): `docker compose config`
Expected: the fully-resolved config prints with no error; `ollama`, `ollama-pull`, and `model` services are present and `model` has no `profiles`.

- [ ] **Step 7: Commit**

```bash
git add docker-compose.yml
git commit -m "feat(compose): add Ollama services, run model as CPU embed/rerank"
git push
```

---

## Task 5: Env examples + README

**Files:**
- Modify: `.env.example`
- Modify: `BACKEND/.env.example`
- Modify: `MODEL/README.md`
- Manual (gitignored, not committed): `.env`, `BACKEND/.env`

- [ ] **Step 1: Rewrite the root `.env.example`**

Replace the entire contents of `.env.example` with:

```
JWT_SECRET=replace-with-a-long-random-string

POSTGRES_USER=doritos
POSTGRES_PASSWORD=doritos
POSTGRES_DB=doritos

CLIENT_URL=http://localhost:5173
VITE_API_URL=http://localhost:3000

# Generation runs on the local Ollama service.
OLLAMA_URL=http://ollama:11434
GEN_MODEL=qwen3.5:2b

# Embeddings + reranking run on the local CPU model service (MODEL/server.py).
EMBED_API_URL=http://model:5000/embed
RERANK_API_URL=http://model:5000/rerank
EMBED_MODEL_ID=BAAI/bge-small-en-v1.5
RERANK_MODEL_ID=BAAI/bge-reranker-base

# Dormant cloud/GPU alternative: MODEL/modal_app.py deploys server.py to Modal.
# Using it for generation requires reverting the Ollama wiring in index.js.
# MODEL_ID=Qwen/Qwen2-VL-2B-Instruct-AWQ
# MODEL_API_KEY=replace-with-32-byte-random-hex

NODE_ENV=production
```

- [ ] **Step 2: Rewrite `BACKEND/.env.example`**

Replace the entire contents of `BACKEND/.env.example` with:

```
PORT=3000
CLIENT_URL=http://localhost:5173
DATABASE_URL=postgresql://doritos:doritos@localhost:5440/doritos?schema=public
JWT_SECRET=replace-with-a-long-random-string

# Generation runs on a local Ollama instance.
OLLAMA_URL=http://localhost:11434
GEN_MODEL=qwen3.5:2b

# Embeddings + reranking — the local CPU model service (MODEL/server.py).
EMBED_API_URL=http://localhost:5000/embed
RERANK_API_URL=http://localhost:5000/rerank

# Only needed if pointing embed/rerank at a Modal deployment (see modal_app.py).
# MODEL_API_KEY=replace-with-32-byte-random-hex

NODE_ENV=development
```

- [ ] **Step 3: Add an offline-mode section to `MODEL/README.md`**

Open `MODEL/README.md`. Immediately after the first top-level heading and its intro paragraph, insert:

```markdown
## Offline mode (default)

The app runs fully offline on CPU. `docker compose up --build` starts:

- `ollama` — generation runtime; `ollama-pull` pulls `GEN_MODEL` (default
  `qwen3.5:2b`) on first start. The first pull needs internet (~2 GB) and is
  cached in the `ollama_data` volume afterward.
- `model` — `server.py` with `ENABLE_GENERATION=false`: it skips the VLM and
  serves only `/embed` and `/rerank` on CPU.

Generation is slow on CPU (~6–10 tok/s); a 2B model is the sweet spot. Swap it
with `GEN_MODEL` (e.g. `gemma4:e2b`).

The Modal/GPU path (`modal_app.py`, `train.py`, and `server.py`'s generation
code) stays in the repo as the dormant cloud alternative.
```

- [ ] **Step 4: Commit the committed files**

```bash
git add .env.example BACKEND/.env.example MODEL/README.md
git commit -m "docs(env): document the offline Ollama setup"
git push
```

- [ ] **Step 5: Update the gitignored local env files (not committed)**

These two files are gitignored — edit them on disk so the running app picks up the new config. The root `.env` is read by Docker Compose for `${VAR}` interpolation, so its stale Modal URLs **must** be removed or they override the compose defaults.

In `.env` (repo root): set `OLLAMA_URL=http://ollama:11434`, `GEN_MODEL=qwen3.5:2b`, `EMBED_API_URL=http://model:5000/embed`, `RERANK_API_URL=http://model:5000/rerank`, and **delete** any `QWEN_API_URL` / `QWEN_STREAM_URL` lines and any Modal `EMBED_API_URL` / `RERANK_API_URL` lines.

In `BACKEND/.env`: set `OLLAMA_URL=http://localhost:11434`, `GEN_MODEL=qwen3.5:2b`, `EMBED_API_URL=http://localhost:5000/embed`, `RERANK_API_URL=http://localhost:5000/rerank`, and delete the `QWEN_API_URL` / `QWEN_STREAM_URL` lines.

Verify: `git status` shows only the committed files from Step 4 — `.env` and `BACKEND/.env` must NOT appear.

---

## Task 6: End-to-end verification

**Files:** none (verification only — no commit).

- [ ] **Step 1: Build and start the stack**

Run (from the repo root): `docker compose up --build -d`
Expected: `postgres`, `ollama`, `ollama-pull`, `model`, `backend`, `client` are created.

- [ ] **Step 2: Wait for the model pull**

Run: `docker compose logs -f ollama-pull`
Expected: pull progress for `qwen3.5:2b`, then the container exits `0`. (First run downloads ~2 GB — give it a few minutes.)

- [ ] **Step 3: Confirm the CPU model service loaded embed + rerank only**

Run: `docker compose logs model`
Expected: `ENABLE_GENERATION=false — skipping VLM load`, then `Embedding model ready.` and `Reranker ready.` — and **no** `Loading VLM`.

- [ ] **Step 4: Exercise RAG end-to-end**

Open `http://localhost:5173`. Sign up, upload a document, ask a question grounded in it.
Expected: the answer streams token-by-token (slow on CPU is fine); sources/citations appear.

- [ ] **Step 5: Exercise an image question**

In a chat, attach an image and ask about it.
Expected: a relevant answer (slower than text — CPU vision encoding).

- [ ] **Step 6: Confirm a clean working tree**

Run: `git status`
Expected: clean — all plan commits are pushed; `.env` / `BACKEND/.env` are gitignored and absent.

---

## Self-Review

- **Spec coverage:** ollama service (Task 4) ✓; `ENABLE_GENERATION` flag (Task 2) ✓; `ollama.js` adapter (Task 1) ✓; rewire `streamFromModel` + `/api/generate` (Task 3) ✓; env files (Task 5) ✓; `MODEL/README.md` (Task 5) ✓; build sequence + end-to-end verification (Task 6) ✓. Modal files left dormant — no task touches them, as intended ✓.
- **Placeholder scan:** every code/edit step shows complete content; no TBD/TODO.
- **Type consistency:** `toOllamaMessages`, `streamChat`, `generateOnce` are defined in Task 1 and consumed with matching signatures in Task 3. `ENABLE_GENERATION` is defined and read within Task 2. `OLLAMA_URL` / `GEN_MODEL` env names are consistent across `ollama.js`, `docker-compose.yml`, and the env files.
