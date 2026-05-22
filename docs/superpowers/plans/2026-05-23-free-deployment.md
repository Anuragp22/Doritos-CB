# Free Live Demo Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put Doritos AI online behind a free, public, shareable URL so it can be linked from a CV.

**Architecture:** Client on Vercel, Express backend (Docker) on Render, Postgres+pgvector on Neon, a new CPU Modal app for embeddings/reranking, plus the existing Groq/Gemini/Modal-SAM2 cloud integrations. Offline (Ollama) mode is disabled in the deployed build via a Vite build flag.

**Tech Stack:** Vercel, Render, Neon, Modal, Vite, Express, Prisma 7, Docker.

---

## Execution notes

- **Branch:** This project commits straight to `main` (the user wants per-commit pushes for GitHub profile visibility). Work on `main` unless the executing skill's consent gate says otherwise.
- **Per-commit push:** After every commit, run `git push` immediately. Never batch.
- **No `Co-Authored-By` trailer** on commits.
- **`git add` explicit paths only** — never `git add .` or `git add -A`. The repo contains personal files (`cv.tex`, `cv.pdf`, build artifacts) that must never be committed.
- **Task split:** Tasks 1–4 are repo changes (code/config, committed). Tasks 5–9 are **operator tasks** — provisioning in external dashboards; they produce no repo commits. Task 10 updates the README. Each task marks **Who/Where** it runs.
- Tasks 5–9 must run in order (each needs a URL/secret produced by the previous one).

---

## File structure

| File | Status | Responsibility |
|---|---|---|
| `BACKEND/middleware/auth.js` | Modify | `cookieOptions()` — cross-site cookie in production |
| `BACKEND/middleware/auth.test.js` | Create | Unit test for `cookieOptions()` |
| `CLIENT/src/components/agentic.jsx` | Modify | Build-flag gate for offline mode |
| `MODEL/modal_embed.py` | Create | CPU Modal app: `/embed` + `/rerank` from `server.py` |
| `CLIENT/vercel.json` | Create | SPA rewrite fallback for React Router |
| `CLIENT/.npmrc` | Create | `legacy-peer-deps=true` so Vercel's `npm install` works |
| `README.md` | Modify | Live demo URL + short deployment section |

No backend route code, no `embed.js`/`rerank.js`, no Dockerfile changes are needed: the backend reaches the model service purely through `EMBED_API_URL`/`RERANK_API_URL`, and `modelClient.js` already sends the `MODEL_API_KEY` Bearer token. `index.js`'s `cors()` already has `credentials: true` (verified).

---

## Task 1: Cross-site cookie configuration

**Who/Where:** Runs in the repo.

**Files:**
- Modify: `BACKEND/middleware/auth.js:20-25`
- Create: `BACKEND/middleware/auth.test.js`

Vercel and Render are different registrable sites. A `sameSite: 'lax'` cookie is not sent on cross-site requests, so login would silently fail in the deployed app. In production the JWT cookie must be `sameSite: 'none'` + `secure: true`.

- [ ] **Step 1: Write the failing test**

Create `BACKEND/middleware/auth.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { cookieOptions } from './auth.js';

test('cookieOptions: production uses cross-site cookie settings', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  try {
    const opts = cookieOptions();
    assert.equal(opts.sameSite, 'none');
    assert.equal(opts.secure, true);
    assert.equal(opts.httpOnly, true);
  } finally {
    process.env.NODE_ENV = prev;
  }
});

test('cookieOptions: non-production uses a lax, insecure cookie', () => {
  const prev = process.env.NODE_ENV;
  process.env.NODE_ENV = 'development';
  try {
    const opts = cookieOptions();
    assert.equal(opts.sameSite, 'lax');
    assert.equal(opts.secure, false);
  } finally {
    process.env.NODE_ENV = prev;
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd BACKEND; node --test middleware/auth.test.js`
Expected: the production test FAILS (`opts.sameSite` is `'lax'`, expected `'none'`). The non-production test passes.

- [ ] **Step 3: Update `cookieOptions()`**

In `BACKEND/middleware/auth.js`, replace the `cookieOptions` export (currently lines 20-25):

```js
export const cookieOptions = () => {
  // In production the client (Vercel) and API (Render) are on different
  // sites, so the auth cookie must be SameSite=None; Secure to be sent at
  // all. Locally both are on localhost, where Lax works and Secure would
  // break plain-HTTP dev.
  const crossSite = process.env.NODE_ENV === 'production';
  return {
    httpOnly: true,
    sameSite: crossSite ? 'none' : 'lax',
    secure: crossSite,
    maxAge: 7 * 24 * 60 * 60 * 1000,
  };
};
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd BACKEND; node --test middleware/auth.test.js`
Expected: both tests PASS.

- [ ] **Step 5: Commit and push**

```bash
git add BACKEND/middleware/auth.js BACKEND/middleware/auth.test.js
git commit -m "fix(auth): cross-site cookie for split client/API hosting"
git push
```

---

## Task 2: Build-time offline-mode flag in the client

**Who/Where:** Runs in the repo.

**Files:**
- Modify: `CLIENT/src/components/agentic.jsx:7-53`

The deployed build has no Ollama server, so offline mode must be hidden. A Vite build flag `VITE_OFFLINE_MODE` controls it: when `'false'`, the app locks to agentic mode and the toggle disappears. When unset (local dev), both modes work exactly as today.

This project has no client-side test runner (`CLIENT/package.json` scripts are `dev`/`build`/`lint`/`preview` only). Verification for this task is lint + build; the functional check happens in Task 9 after the Vercel deploy.

- [ ] **Step 1: Add the build-flag constant**

In `CLIENT/src/components/agentic.jsx`, find:

```js
const MODE_KEY = 'doritos-chat-mode';
```

Replace it with:

```js
const MODE_KEY = 'doritos-chat-mode';

// Offline mode runs generation on a local Ollama server. A deployment without
// one (the hosted demo) sets VITE_OFFLINE_MODE=false at build time, which
// locks the app to agentic mode and hides the toggle. Unset = both modes on.
const OFFLINE_ENABLED = import.meta.env.VITE_OFFLINE_MODE !== 'false';
```

- [ ] **Step 2: Lock `useChatMode` to agentic when offline is disabled**

Replace the whole `useChatMode` function with:

```js
// Chat mode persisted in localStorage so it carries across the dashboard
// composer and the in-chat composer.
export function useChatMode() {
  const [mode, setModeState] = useState(() => {
    if (!OFFLINE_ENABLED) return 'agentic';
    try {
      return localStorage.getItem(MODE_KEY) === 'agentic' ? 'agentic' : 'offline';
    } catch {
      return 'offline';
    }
  });
  const setMode = (next) => {
    if (!OFFLINE_ENABLED) return; // locked to agentic — no offline server
    setModeState(next);
    try {
      localStorage.setItem(MODE_KEY, next);
    } catch {
      // localStorage unavailable — keep the in-memory value
    }
  };
  return [mode, setMode];
}
```

- [ ] **Step 3: Hide the toggle when offline is disabled**

In `ModeToggle`, add an early return as the first line of the function body, immediately before `return (`:

```js
export function ModeToggle({ mode, setMode, disabled }) {
  if (!OFFLINE_ENABLED) return null; // one mode only — nothing to toggle
  return (
    <div className="dispatch-mode" role="group" aria-label="Chat mode">
```

Leave the rest of `ModeToggle`, `applyStepEvent`, `stepLabel`, and `AgentSteps` unchanged.

- [ ] **Step 4: Verify lint and build pass**

Run: `cd CLIENT; npm run lint`
Expected: no errors (exit 0).

Run: `cd CLIENT; npm run build`
Expected: `vite build` completes, writes `dist/`, exit 0.

- [ ] **Step 5: Commit and push**

```bash
git add CLIENT/src/components/agentic.jsx
git commit -m "feat(client): gate offline mode behind VITE_OFFLINE_MODE flag"
git push
```

---

## Task 3: Modal CPU app for embeddings + reranking

**Who/Where:** Runs in the repo.

**Files:**
- Create: `MODEL/modal_embed.py`

A new Modal app that runs `MODEL/server.py` on a **CPU** container with `ENABLE_GENERATION=false`, exposing `/embed` and `/rerank` behind the existing Bearer auth. It deliberately does not reuse `modal_app.py` (GPU + VLM) — that would load Qwen2-VL and burn GPU credit. The image installs only the packages `server.py` imports, not the full `requirements.txt` (which includes the heavy `llamafactory`).

- [ ] **Step 1: Create `MODEL/modal_embed.py`**

```python
"""Modal deployment for the embedding + reranking service (CPU).

Runs MODEL/server.py with ENABLE_GENERATION=false on a CPU container, so only
the BGE embedder and reranker load — no Qwen2-VL VLM, no GPU. This is what the
hosted demo points EMBED_API_URL / RERANK_API_URL at.

Kept separate from modal_app.py (the GPU VLM deployment): that one loads the
VLM and would waste GPU credit on what is a pure CPU workload.

Setup
-----
    pip install modal
    modal token new                          # one-time auth
    modal secret create doritos-model-auth MODEL_API_KEY=<random-key>

    modal deploy MODEL/modal_embed.py        # deploy
    modal serve  MODEL/modal_embed.py        # ephemeral dev URL, hot reload

After `modal deploy`, Modal prints a public URL. Point the backend at it:

    EMBED_API_URL=https://<workspace>--doritos-ai-embed-fastapi-app.modal.run/embed
    RERANK_API_URL=https://<workspace>--doritos-ai-embed-fastapi-app.modal.run/rerank

Cost: CPU only; min_containers=0 scales to zero (~$0 idle); scaledown_window
keeps a container warm 5 min so back-to-back retrievals stay hot.
"""

from pathlib import Path

import modal

APP_NAME = "doritos-ai-embed"
MODEL_DIR = Path(__file__).resolve().parent

app = modal.App(APP_NAME)

# Reuse the HF cache volume so the BGE checkpoints download once and persist
# across cold starts.
hf_cache = modal.Volume.from_name("doritos-hf-cache", create_if_missing=True)

# CPU image: only the packages server.py imports. ENABLE_GENERATION=false is
# set here so server.py reads it at import time and skips loading the VLM.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .env({"ENABLE_GENERATION": "false"})
    .pip_install(
        "torch",
        "transformers>=4.45",
        "sentence-transformers>=3.0",
        "qwen-vl-utils[decord]>=0.0.8",
        "fastapi[standard]>=0.110",
        "pillow>=10",
    )
    .add_local_dir(str(MODEL_DIR), "/app")
)


class BearerAuthMiddleware:
    """ASGI middleware requiring `Authorization: Bearer <api_key>`.

    Mirrors the middleware in modal_app.py / modal_segment.py. GET / stays
    public as a health / warm-up probe.
    """

    def __init__(self, app, api_key: str):
        self.app = app
        self._expected = f"Bearer {api_key}".encode()

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return
        if scope["path"] == "/" and scope["method"] == "GET":
            await self.app(scope, receive, send)
            return
        for name, value in scope["headers"]:
            if name == b"authorization" and value == self._expected:
                await self.app(scope, receive, send)
                return
        await send(
            {
                "type": "http.response.start",
                "status": 401,
                "headers": [(b"content-type", b"application/json")],
            }
        )
        await send(
            {
                "type": "http.response.body",
                "body": b'{"error":"Invalid or missing API key"}',
            }
        )


@app.function(
    image=image,
    cpu=2.0,
    memory=2048,
    volumes={"/root/.cache/huggingface": hf_cache},
    secrets=[modal.Secret.from_name("doritos-model-auth")],
    min_containers=0,
    scaledown_window=300,
    timeout=300,
    max_containers=2,
)
@modal.asgi_app()
def fastapi_app():
    """Mount server.py's FastAPI app behind the API-key check.

    server.py uses a `lifespan` handler to load models. With
    ENABLE_GENERATION=false (set on the image) it loads only the embedder and
    reranker, on CPU, exactly once per cold start.
    """
    import os
    import sys

    sys.path.insert(0, "/app")
    from server import app as inner_app  # noqa: WPS433

    api_key = os.environ.get("MODEL_API_KEY")
    if not api_key:
        raise RuntimeError(
            "MODEL_API_KEY is missing. Create the Modal secret with:\n"
            "  modal secret create doritos-model-auth MODEL_API_KEY=<random-key>"
        )

    inner_app.add_middleware(BearerAuthMiddleware, api_key=api_key)
    return inner_app
```

- [ ] **Step 2: Syntax-check the file**

Run: `python -m py_compile MODEL/modal_embed.py`
Expected: exit 0, no output.

- [ ] **Step 3: Commit and push**

```bash
git add MODEL/modal_embed.py
git commit -m "feat(modal): CPU embed/rerank deployment app"
git push
```

---

## Task 4: Client deployment config

**Who/Where:** Runs in the repo.

**Files:**
- Create: `CLIENT/vercel.json`
- Create: `CLIENT/.npmrc`

React Router needs every path to serve `index.html` (a deep link like `/dashboard/chats/abc` must not 404). And React 19 RC requires `legacy-peer-deps`; an `.npmrc` makes Vercel's default `npm install` work without a custom flag.

- [ ] **Step 1: Create `CLIENT/vercel.json`**

```json
{
  "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }]
}
```

- [ ] **Step 2: Create `CLIENT/.npmrc`**

```
legacy-peer-deps=true
```

- [ ] **Step 3: Verify both files**

Run: `node -e "JSON.parse(require('fs').readFileSync('CLIENT/vercel.json','utf8')); console.log('vercel.json OK')"`
Expected: prints `vercel.json OK`.

Run: `cd CLIENT; npm config get legacy-peer-deps`
Expected: prints `true` (the `.npmrc` is being read).

- [ ] **Step 4: Commit and push**

```bash
git add CLIENT/vercel.json CLIENT/.npmrc
git commit -m "chore(client): Vercel SPA rewrite and legacy-peer-deps npmrc"
git push
```

---

## Task 5: Deploy the embed/rerank service to Modal

**Who/Where:** Operator — run the `modal` CLI from the repo root. Requires `modal` installed and authenticated (it already is — SAM2 was deployed from here). If not: `pip install modal` then `modal token new`.

**Files:** none (deploys Task 3's file).

- [ ] **Step 1: Confirm the auth secret exists**

Run: `modal secret list`
Expected: `doritos-model-auth` appears in the list (it is shared with the SAM2 deployment). If it is missing, create it:
`modal secret create doritos-model-auth MODEL_API_KEY=<your-MODEL_API_KEY>` — use the same value already in the repo-root `.env`.

- [ ] **Step 2: Deploy**

Run: `modal deploy MODEL/modal_embed.py`
Expected: build succeeds; Modal prints a deployed URL ending in `--doritos-ai-embed-fastapi-app.modal.run`. Record it as `<EMBED_URL>`.

- [ ] **Step 3: Verify the health endpoint**

Run: `curl <EMBED_URL>/`
Expected: JSON like `{"status":"running","model_id":null,"embed_model_id":"BAAI/bge-small-en-v1.5","rerank_model_id":"BAAI/bge-reranker-base","device":"cpu"}`. `model_id` is `null` — confirms the VLM was not loaded. The first call may take 30–60s (cold start + model download).

- [ ] **Step 4: Verify the authenticated `/embed` endpoint**

Run (substitute the real key — the `MODEL_API_KEY` from the repo-root `.env`):
```bash
curl -X POST <EMBED_URL>/embed -H "Authorization: Bearer <MODEL_API_KEY>" -H "Content-Type: application/json" -d "{\"inputs\":[\"hello world\"]}"
```
Expected: `{"embeddings":[[ ...384 floats... ]]}`.

Also confirm auth is enforced — run the same `curl` **without** the `Authorization` header:
Expected: `{"error":"Invalid or missing API key"}` with HTTP 401.

- [ ] **Step 5: Record the URLs**

Write down for Task 7:
- `EMBED_API_URL` = `<EMBED_URL>/embed`
- `RERANK_API_URL` = `<EMBED_URL>/rerank`

---

## Task 6: Provision the Neon Postgres database

**Who/Where:** Operator — in a browser at <https://neon.tech>.

**Files:** none.

- [ ] **Step 1: Create the project**

Sign up / log in at <https://neon.tech>. Create a new project; accept the default Postgres version (16 or newer). Name it e.g. `doritos-ai`.

- [ ] **Step 2: Copy the direct connection string**

In the project's **Connection Details** panel, **turn the "Connection pooling" toggle OFF** and copy the connection string. It looks like:
`postgresql://<user>:<password>@ep-xxxx.<region>.aws.neon.tech/<dbname>?sslmode=require`

The direct (non-pooled) string is used because the backend runs `prisma migrate deploy` on startup, and migrations need a real session connection, not PgBouncer.

- [ ] **Step 2 note:** No manual pgvector step is needed — the migration `prisma/migrations/20260507010000_add_documents_with_pgvector/migration.sql` runs `CREATE EXTENSION IF NOT EXISTS vector`, and Neon allows the `vector` extension.

- [ ] **Step 3: Record it**

Write down `DATABASE_URL` = the copied connection string, for Task 7. (Connectivity is verified in Task 7 — the backend's `prisma migrate deploy` is the real test.)

---

## Task 7: Deploy the backend to Render

**Who/Where:** Operator — in a browser at <https://render.com>. Depends on Tasks 5 and 6.

**Files:** none (deploys `BACKEND/Dockerfile`).

- [ ] **Step 1: Generate a JWT secret**

Run: `node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`
Record the output as `<JWT_SECRET>`.

- [ ] **Step 2: Create the web service**

At <https://render.com>: **New → Web Service**, connect the GitHub repo `Anuragp22/Doritos-CB` (authorize Render's GitHub app). Settings:
- **Root Directory:** `BACKEND`
- **Runtime / Language:** Docker (Render auto-detects `BACKEND/Dockerfile`)
- **Branch:** `main`
- **Instance Type:** Free

Do not set a Start Command — the Dockerfile's `CMD` already runs `prisma generate && prisma migrate deploy && node index.js`. Do not set `PORT` — Render injects it and `index.js` reads `process.env.PORT`.

- [ ] **Step 3: Set environment variables**

Add these under the service's **Environment** section:

| Key | Value |
|---|---|
| `NODE_ENV` | `production` |
| `JWT_SECRET` | `<JWT_SECRET>` from Step 1 |
| `DATABASE_URL` | the Neon string from Task 6 |
| `CLIENT_URL` | `https://placeholder.vercel.app` (corrected in Task 9) |
| `GROQ_API_KEY` | the `GROQ_API_KEY` value from the repo-root `.env` |
| `AGENT_MODEL` | `qwen/qwen3-32b` |
| `GEMINI_API_KEY` | the `GEMINI_API_KEY` value from the repo-root `.env` |
| `GEMINI_MODEL` | `gemini-2.5-flash` |
| `EMBED_API_URL` | `<EMBED_URL>/embed` from Task 5 |
| `RERANK_API_URL` | `<EMBED_URL>/rerank` from Task 5 |
| `MODEL_API_KEY` | the `MODEL_API_KEY` value from the repo-root `.env` |
| `SEGMENT_API_URL` | the `SEGMENT_API_URL` value from the repo-root `.env` |

`OLLAMA_URL` and `GEN_MODEL` are intentionally omitted — offline mode is disabled in the deployed client, so the offline code path is unreachable. The backend logs one harmless `OLLAMA_URL not set` warning on boot.

- [ ] **Step 4: Deploy and watch the logs**

Trigger the deploy. In the log stream, confirm:
- `prisma migrate deploy` applies the migrations (`5 migrations found`, all applied / "Database schema is up to date").
- The server prints its listening line and Render marks the service **Live**.

If the logs show a Postgres SSL/connection error, edit `DATABASE_URL` to drop a trailing `&channel_binding=require` if present, keep `?sslmode=require`, and redeploy.

- [ ] **Step 5: Verify the API is up**

Record the service URL `https://<service>.onrender.com` as `<RENDER_URL>`.

Run: `curl <RENDER_URL>/api/auth/me`
Expected: HTTP 401 `{"error":"Unauthenticated"}` — the server is up and routing. (The first request after idle takes 30–60s while the free instance wakes.)

---

## Task 8: Deploy the client to Vercel

**Who/Where:** Operator — in a browser at <https://vercel.com>. Depends on Task 7.

**Files:** none (builds `CLIENT/`).

- [ ] **Step 1: Import the project**

At <https://vercel.com>: **Add New → Project**, import `Anuragp22/Doritos-CB`. Settings:
- **Root Directory:** `CLIENT`
- **Framework Preset:** Vite (auto-detected)
- Leave Build Command (`npm run build`) and Output Directory (`dist`) at the auto defaults.

- [ ] **Step 2: Set environment variables**

Add two **Environment Variables** (all environments):

| Key | Value |
|---|---|
| `VITE_API_URL` | `<RENDER_URL>` from Task 7 (no trailing slash) |
| `VITE_OFFLINE_MODE` | `false` |

- [ ] **Step 3: Deploy**

Trigger the deploy. Record the resulting URL `https://<project>.vercel.app` as `<VERCEL_URL>`.

- [ ] **Step 4: Smoke-check**

Open `<VERCEL_URL>` in a browser.
Expected: the app loads (the sign-in / landing page renders). Auth and chat are not expected to work yet — Task 9 fixes the CORS/cookie origin.

---

## Task 9: Back-fill `CLIENT_URL` and verify end-to-end

**Who/Where:** Operator — Render dashboard + a browser. Depends on Task 8.

**Files:** none.

- [ ] **Step 1: Correct `CLIENT_URL` on Render**

In the Render service's Environment settings, change `CLIENT_URL` from the placeholder to `<VERCEL_URL>` (no trailing slash). Save — Render redeploys automatically. Wait for **Live**.

- [ ] **Step 2: Auth round-trip** — On `<VERCEL_URL>`, register a new account and confirm you land logged-in in the dashboard. Reload the page — you stay logged in. *Verifies the cross-site cookie (Task 1).*

- [ ] **Step 3: Agentic text chat** — Send a text-only message. Confirm the answer streams in token by token. *Verifies Groq + SSE through Render.*

- [ ] **Step 4: Document RAG** — Upload a document (Documents page), wait until it finishes processing (status leaves `processing` and a chunk count appears), then ask a question answerable from it. Confirm a "Searching documents" step appears and the answer carries `[n]` citations. *Verifies Neon pgvector + the Modal embed/rerank service + the agent's search tool.*

- [ ] **Step 5: Image chat** — Attach an image to a chat turn and send it. Confirm a description streams back. *Verifies Gemini.*

- [ ] **Step 6: Segmentation** — Attach an image, click "Select object", click a point on the object, apply. Confirm the cutout is produced. *Verifies the Modal SAM2 path.*

- [ ] **Step 7: UI + routing** — Confirm the offline/agentic mode toggle is **absent**. Navigate into a chat, copy the URL, open it in a new tab — it loads the chat, not a 404. *Verifies the build flag (Task 2) and the SPA rewrite (Task 4).*

- [ ] **Step 8:** If every check passes, record `<VERCEL_URL>` — this is the live demo link for the CV.

---

## Task 10: Document the live demo in the README

**Who/Where:** Runs in the repo. Depends on Task 9 (needs `<VERCEL_URL>`).

**Files:**
- Modify: `README.md`

- [ ] **Step 1: Add a live-demo line under the title**

In `README.md`, directly under the `# Doritos AI` heading, add a blank line then:

```markdown
**Live demo:** <VERCEL_URL>

> The hosted demo runs agentic mode only — offline (Ollama) mode needs a local
> model server and is available when you run the stack yourself (see below).
```

Replace `<VERCEL_URL>` with the real URL from Task 9.

- [ ] **Step 2: Add a Deployment section**

Append this section to `README.md`, immediately before the final `## Notes` section:

```markdown
## Deployment

The hosted demo is split across free tiers:

| Component | Host |
|-----------|------|
| Client (React SPA) | Vercel |
| Backend (Express) | Render (Docker web service) |
| Postgres + pgvector | Neon |
| Embeddings + reranking | Modal (CPU) — `MODEL/modal_embed.py` |
| Generation / image / segmentation | Groq · Gemini · Modal SAM2 |

Offline (Ollama) mode is disabled in the hosted build via `VITE_OFFLINE_MODE=false`;
no free tier can host a local LLM. The full step-by-step deployment runbook is in
[`docs/superpowers/plans/2026-05-23-free-deployment.md`](docs/superpowers/plans/2026-05-23-free-deployment.md).
```

- [ ] **Step 3: Verify**

Run: `node -e "const s=require('fs').readFileSync('README.md','utf8'); if(!s.includes('Live demo:')||!s.includes('## Deployment'))process.exit(1); console.log('README OK')"`
Expected: prints `README OK`.

- [ ] **Step 4: Commit and push**

```bash
git add README.md
git commit -m "docs(readme): live demo URL and deployment section"
git push
```

---

## Verification (whole plan)

The deployed demo is correct when all eight checks in Task 9 pass: cross-site auth, streamed agentic chat, document RAG with citations, image chat, segmentation, the toggle being absent, SPA deep-link routing — and the README carries the live URL. Cold starts (Render ~30–60s, Modal embed ~20–40s after idle) are expected and accepted.
