# Free Live Demo Deployment — Design

**Date:** 2026-05-23
**Status:** Approved

## Goal

Put Doritos AI online behind a public, shareable URL — at **$0/month** — so it
can be linked from a CV/portfolio. The deployed demo runs agentic RAG chat,
image chat, and object segmentation. Offline (Ollama) mode is excluded because
no free tier can host a local LLM.

## Context

Today the app only runs locally via `docker compose up`. The Compose stack has
six services: `client`, `backend`, `postgres` (pgvector), `model` (CPU
embeddings + reranking, PyTorch), `ollama` (offline generation), and a one-shot
`ollama-pull`. Three integrations are already cloud-based: Groq (agentic
generation), Gemini (image chat), and Modal (SAM2 segmentation, already
deployed).

The blocker for a free deploy is compute weight: `ollama` and `model` need
gigabytes of RAM and cannot run on free hosting. Everything else is light or
already in the cloud.

Key facts confirmed in the codebase:

- `MODEL/server.py` supports `ENABLE_GENERATION=false` — skips loading the VLM
  and serves only `/embed` and `/rerank` on CPU.
- `BACKEND/lib/modelClient.js` already injects `MODEL_API_KEY` as a Bearer
  token on every embed/rerank call. A Bearer-gated Modal endpoint works with
  no backend change.
- `BACKEND/lib/embed.js` / `lib/rerank.js` reach the model service purely
  through `EMBED_API_URL` / `RERANK_API_URL` env vars — the endpoint is
  swappable with no code change.
- `BACKEND/middleware/auth.js` `cookieOptions()` uses `sameSite: 'lax'`. This
  works locally (client and backend are both `localhost`, same site) but fails
  cross-site between Vercel and Render.
- `CLIENT/src/components/agentic.jsx` owns the offline/agentic mode toggle
  (`useChatMode`, `ModeToggle`), defaulting to `offline`.

## Architecture

```
   Recruiter's browser
          │
          ▼
   ┌──────────────┐   /api (HTTPS, cookies)   ┌──────────────────┐
   │ Vercel       │ ────────────────────────► │ Render           │
   │ React SPA    │ ◄──────────── SSE ─────── │ Express backend  │
   │ (free)       │                           │ Docker, free     │
   └──────────────┘                           └────────┬─────────┘
                                                        │
                          ┌─────────────────────────────┼───────────────┐
                          ▼                ▼             ▼               ▼
                    ┌───────────┐   ┌────────────┐  ┌─────────┐   ┌────────────┐
                    │ Neon      │   │ Modal CPU  │  │ Groq /  │   │ Modal SAM2 │
                    │ Postgres  │   │ embed +    │  │ Gemini  │   │ (already   │
                    │ +pgvector │   │ rerank     │  │ (cloud) │   │  deployed) │
                    └───────────┘   └────────────┘  └─────────┘   └────────────┘
```

| Component | Host | Tier / cost | Notes |
|---|---|---|---|
| Client (React SPA) | Vercel | Free | Static build, no sleep, custom domain available |
| Backend (Express, SSE) | Render | Free web service | Docker deploy; sleeps after 15 min idle |
| Postgres + pgvector | Neon | Free | Serverless; compute auto-suspends, wakes ~1 s |
| Embed + rerank | Modal | Free ($30/mo credit) | New CPU app; scale-to-zero |
| Agentic generation | Groq | Free API key | Already wired |
| Image chat | Gemini | Free API key | Already wired |
| Segmentation | Modal SAM2 | Free credit | Already deployed |

## Components / changes

### Change 1 — Cross-site cookie (`BACKEND/middleware/auth.js`)

Vercel (`*.vercel.app`) and Render (`*.onrender.com`) are different registrable
sites. A `sameSite: 'lax'` cookie is not sent on cross-site XHR, so auth would
silently fail. `cookieOptions()` must use `sameSite: 'none'` + `secure: true`
in production, keeping `'lax'` for local dev.

```js
export const cookieOptions = () => {
  const crossSite = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure: crossSite,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
};
```

`secure: true` requires HTTPS — both Vercel and Render serve HTTPS, so this is
satisfied.

### Change 2 — Build-time offline-mode flag (`CLIENT/src/components/agentic.jsx`)

A Vite build flag `VITE_OFFLINE_MODE` controls whether offline mode is
available. When the deployed build sets `VITE_OFFLINE_MODE=false`:

- `useChatMode` ignores localStorage and returns a fixed `'agentic'` mode.
- `ModeToggle` renders `null` — no toggle, since there is only one mode.

When the flag is unset (local dev), behavior is unchanged: both modes available,
offline is the default. The composer continues to send `mode` in the `PUT`
body; with the flag off it is always `'agentic'`.

### Change 3 — Modal CPU embed/rerank app (`MODEL/modal_embed.py`, new)

A new Modal app that runs `MODEL/server.py` on a CPU container with
`ENABLE_GENERATION=false`, exposing `/embed` and `/rerank`. Structure mirrors
`MODEL/modal_segment.py`:

- CPU container (no GPU) — embeddings and small-batch reranking are fast on CPU
  and cheap.
- `ENABLE_GENERATION=false` so the Qwen2-VL VLM is never loaded — fast cold
  start, low memory.
- Bearer-auth middleware gated by the existing `doritos-model-auth` Modal
  secret (`MODEL_API_KEY`), same as `modal_segment.py`.
- `min_containers=0` (scale to zero) — cost ≈ $0 when idle, within the Modal
  free credit.

The existing `MODEL/modal_app.py` is deliberately not reused: it is configured
for GPU generation and would load the VLM, wasting GPU credit and slowing cold
starts.

### Change 4 — SPA fallback (`CLIENT/vercel.json`, new)

A `vercel.json` rewrite so React Router deep links resolve to `index.html`:

```json
{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }
```

### Change 5 — CORS credentials check (`BACKEND/index.js`)

The `cors()` config must include `credentials: true` for cookies to cross
origins. It is very likely already present (cookies work in local dev). Verify
during implementation; add it if missing.

## Deployment sequence

Code and config changes are made in the repo first; then the four services are
provisioned. The user performs account signups and the "deploy" clicks; the
implementer supplies exact env-var values and step-by-step instructions.

1. **Modal** — `modal deploy MODEL/modal_embed.py`. Record the printed URL;
   `EMBED_API_URL` and `RERANK_API_URL` are `<url>/embed` and `<url>/rerank`.
2. **Neon** — create a project; copy the connection string. pgvector is
   enabled by the existing `prisma/migrations` (`CREATE EXTENSION vector`),
   which Neon supports.
3. **Render** — create a web service from `BACKEND/Dockerfile`. Set env vars
   (see below). The Dockerfile already runs `prisma migrate deploy` on startup,
   so the schema is applied before the API listens. Record the service URL.
4. **Vercel** — import the repo, root `CLIENT`, framework Vite. Set
   `VITE_API_URL` = Render URL and `VITE_OFFLINE_MODE=false`. Record the
   deployment URL.
5. **Back-fill** — set Render's `CLIENT_URL` to the real Vercel URL and
   redeploy the backend so CORS and the cookie domain are correct.

### Render backend env vars

| Var | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | fresh 48-byte random hex |
| `DATABASE_URL` | Neon connection string |
| `CLIENT_URL` | Vercel deployment URL |
| `GROQ_API_KEY` | existing Groq key |
| `AGENT_MODEL` | `qwen/qwen3-32b` |
| `GEMINI_API_KEY` | existing Gemini key |
| `GEMINI_MODEL` | `gemini-2.5-flash` |
| `EMBED_API_URL` | `<modal-embed-url>/embed` |
| `RERANK_API_URL` | `<modal-embed-url>/rerank` |
| `MODEL_API_KEY` | the `doritos-model-auth` secret value |
| `SEGMENT_API_URL` | existing Modal SAM2 URL |

`OLLAMA_URL` and `GEN_MODEL` are intentionally omitted — offline mode is
disabled in the deployed client, so the offline code path is unreachable.

## Known limitations (accepted)

- **No offline mode** in the deployed demo — agentic mode only.
- **Cold starts** — first request after idle: Render backend ~30–60 s, Modal
  embed ~20–40 s. Acceptable for a CV demo.
- **Ephemeral uploads** — Render's free tier has no persistent disk. Uploaded
  images survive a session but are lost on redeploy/restart. A future fix is a
  free object store (e.g. Cloudinary); out of scope here.

## Out of scope

- Hosting offline (Ollama) mode.
- Persistent image storage.
- Custom domains, analytics, CI/CD pipelines.
- Pre-seeding the demo database with sample documents (optional, can be done
  manually after deploy).

## Verification

1. Visit the Vercel URL; register an account and log in — confirms cross-site
   cookies work.
2. Send a text-only chat turn in agentic mode — confirms Groq + SSE streaming.
3. Upload a document, wait for ingestion, ask a question answerable from it —
   confirms Neon pgvector + the Modal embed/rerank service + the agent's
   `search_documents` tool, with `[n]` citations.
4. Attach an image and send a turn — confirms Gemini image chat.
5. Attach an image and use "Select object" — confirms the Modal SAM2 path.
6. Confirm the offline/agentic toggle is absent in the deployed UI.
7. Deep-link directly to a chat URL and refresh — confirms the SPA fallback.
