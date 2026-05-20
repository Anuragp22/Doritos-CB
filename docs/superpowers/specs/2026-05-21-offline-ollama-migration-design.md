# Offline Ollama Migration — Design

- **Date:** 2026-05-21
- **Status:** Approved
- **Topic:** Move generation off Modal/GPU to a local Ollama service so the whole app runs offline on CPU.

## Context

The app (multimodal RAG chat — Qwen2-VL + hybrid retrieval) currently calls a
GPU model service for three things: generation, embeddings, reranking. The
service runs either as a local `MODEL/server.py` (needs an NVIDIA GPU) or on
Modal (cloud GPU). The target deployment has **no GPU and no hosted platform** —
it must run fully offline on a CPU machine with 16 GB RAM.

Generation is the only GPU-hungry piece. Embeddings (`bge-small`, 33M) and
reranking (`bge-reranker-base`, 278M) are small encoder models that run fine on
CPU. So generation moves to **Ollama** running a small multimodal model; embed
and rerank stay on `server.py` in a CPU-only mode.

## Goal

Run the complete app offline on CPU: `postgres` + `backend` + `client` +
`ollama` (generation) + `model` (CPU embed/rerank). Image chat input keeps
working via a multimodal model. The Modal/GPU path stays in the repo, dormant.

## Non-goals

- No runtime provider toggle (no Groq, no hosted mode). Offline-only.
- No change to embeddings model or the pgvector schema — `bge-small` (384-dim)
  stays, so no migration and no re-embedding.
- No removal of `modal_app.py`, `train.py`, or `server.py`'s generation code —
  they remain as the optional, dormant cloud/GPU path.
- The cross-encoder reranker is **kept** (biggest quality lever for a small LLM).

## Architecture

| Layer | Runs on |
|---|---|
| Generation | **Ollama** → `qwen3.5:2b` (multimodal, CPU) |
| Embeddings + reranking | `MODEL/server.py`, CPU mode, generation disabled |
| DB / backend / client | local Docker, unchanged |
| Modal + local GPU `server.py` generation | kept in repo, dormant |

Both `qwen3.5:2b` and `gemma4:e2b` are valid; `GEN_MODEL` makes it a one-line
swap. Default `qwen3.5:2b` for stronger document/RAG comprehension.

## Components & changes

### 1. `docker-compose.yml`

- **New `ollama` service** — image `ollama/ollama`, port `11434`, named volume
  for `/root/.ollama` (model cache survives restarts). Runs by default. An
  entrypoint wrapper runs `ollama serve` and pulls `GEN_MODEL` on first start.
- **`model` service** — drop `profiles: [model]` so CPU embed/rerank runs by
  default; add `ENABLE_GENERATION: "false"`; GPU `deploy:` block stays commented
  (it is CPU now). Keeps the HuggingFace cache volume.
- **`trainer` service** — unchanged, stays profile-gated (on-demand).
- **`backend` env** — generation → `OLLAMA_URL=http://ollama:11434` +
  `GEN_MODEL=qwen3.5:2b`; embed/rerank → `http://model:5000/embed|/rerank`.

### 2. `MODEL/server.py`

- Add `ENABLE_GENERATION` env flag (default `true`). When `false`, the lifespan
  handler **skips `_load_vlm`** — the VLM is never loaded, `_state["model"]`
  stays `None`, and `/generate`, `/generate/stream`, `/set_model` already return
  `503` in that state. Embed and rerank load and serve normally.
- This is the only change to `server.py`; its endpoints and protocol are
  untouched, so `embed.js` / `rerank.js` need no changes.

### 3. `BACKEND/lib/ollama.js` (new)

A thin adapter for Ollama's native API:

- **`streamChat(messages, { signal })`** — converts the backend's internal
  message format (`{ role, content: [{type:'text'|'image', ...}] }`) to Ollama's
  `/api/chat` shape (`{ role, content: <joined text>, images: [<base64>...] }`,
  stripping the `data:` URI prefix). POSTs with `stream: true`, parses the
  NDJSON stream, yields text deltas.
- **`generateOnce({ user_text, image_url })`** — single non-streaming
  `/api/chat` call (`stream: false`); returns `message.content`.
- Reads `OLLAMA_URL` and `GEN_MODEL` from env.

### 4. `BACKEND/index.js`

- `streamFromModel` calls `ollama.streamChat(...)` instead of
  `modelClient.post(QWEN_STREAM_URL, ...)`, iterating the yielded deltas into
  the existing SSE `sendSSE(res, { text })` path.
- `/api/generate` calls `ollama.generateOnce(...)` instead of
  `modelClient.post(QWEN_API_URL, ...)`.
- The startup guard switches from `QWEN_API_URL` to `OLLAMA_URL`.
- `modelClient` is still imported and used by `embed.js` / `rerank.js`
  (unchanged) — it stays.

### 5. Env files

- `.env` / `.env.example` (root) and `BACKEND/.env.example`: add `OLLAMA_URL`
  and `GEN_MODEL`; point `EMBED_API_URL` / `RERANK_API_URL` at the local `model`
  service; demote the Modal `QWEN_*` URLs to commented examples.

### 6. `MODEL/README.md`

- Document the offline run path (`docker compose up`), the `ENABLE_GENERATION`
  flag, and that Ollama serves generation. Note the Modal path is the dormant
  alternative.

## Data flow (a RAG chat turn, offline)

1. Backend receives the user message, runs `hybridRetrieve` →
   `embed.js`/`rerank.js` call `model` (`server.py` CPU) for query embedding +
   reranking of pgvector/FTS candidates.
2. Backend builds the augmented prompt + history as internal messages.
3. `streamFromModel` → `ollama.streamChat` → Ollama `/api/chat` (`qwen3.5:2b`),
   streaming NDJSON deltas back as SSE to the client.
4. Assistant message + sources persisted to Postgres.

## Risks & tradeoffs

- **Speed.** CPU 2B generation is ~6–10 tok/s; with RAG-context prefill, an
  answer is ~15–40 s. Accepted. Mitigations available: smaller `GEN_MODEL`
  (`gemma4:e2b`), fewer reranked chunks.
- **Model pull on first start.** ~2 GB download for `qwen3.5:2b` — needs
  internet once; fully offline afterward (cached in the `ollama` volume).
- **Image questions are slower** (CPU vision encoding). Acceptable for a demo.

## Build sequence

1. `server.py` — add `ENABLE_GENERATION` flag.
2. `docker-compose.yml` — add `ollama` service, adjust `model` service.
3. `BACKEND/lib/ollama.js` — new adapter.
4. `BACKEND/index.js` — rewire `streamFromModel` + `/api/generate`.
5. Env files + `MODEL/README.md`.
6. Verify end-to-end: `docker compose up`, sign up, upload a doc, ask a grounded
   question, confirm streaming; test an image question.
