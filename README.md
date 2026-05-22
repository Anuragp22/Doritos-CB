# Doritos AI

A local, multimodal chat assistant built around the Qwen2-VL vision-language
model. Users sign in with email and password, send text and image prompts,
and get model-generated descriptions back. Conversation history is stored in
PostgreSQL; uploaded images are served directly from the backend.

The whole stack runs offline — no Clerk, no MinIO/S3, no Gemini, no ngrok or
gradio share tunnels. Everything is wired up to communicate over `localhost`
(or via Docker's internal network).

## Architecture

```
                 Browser
                    |
                    v
        +-------------------+   /api    +------------------------+
        | CLIENT            | --------> | BACKEND (Express)      |
        | React SPA + nginx | <-------- | port 3000              |
        | host port 5173    |    SSE    | JWT auth, Prisma ORM   |
        +-------------------+           +-----------+------------+
                                                    |
              +------------------+------------------+------------------+
              |                  |                  |                  |
       +------v-------+  +--------v-------+  +-------v------+  +--------v-------+
       | postgres     |  | model          |  | ollama       |  | Groq (cloud)   |
       | pgvector+FTS |  | embed + rerank |  | qwen3.5:2b   |  | agentic mode   |
       | host 5440    |  | host 5000, CPU |  | host 11434   |  | optional       |
       +--------------+  +----------------+  +--------------+  +----------------+
```

| Service | Image / build context | Container port | Host port |
|---------|-----------------------|----------------|-----------|
| `client` | `./CLIENT` — React 19 + Vite, nginx in prod | 80 | 5173 |
| `backend` | `./BACKEND` — Express + Prisma + JWT | 3000 | 3000 |
| `postgres` | `pgvector/pgvector:pg16` | 5432 | **5440** |
| `model` | `./MODEL` — FastAPI, CPU embeddings + reranking | 5000 | 5000 |
| `ollama` | `ollama/ollama` — offline-mode text generation | 11434 | 11434 |
| `ollama-pull` | `ollama/ollama` — one-shot model pull, then exits | — | — |
| `trainer` | `./MODEL` — LLaMA-Factory fine-tuning UI | 7860 | 7860 |

`docker compose up` starts every service the app needs — including `model`,
which runs embeddings and reranking on **CPU**. Only `trainer`, the optional
LLaMA-Factory fine-tuning UI, is gated behind the `model` Compose profile.
See [`MODEL/README.md`](MODEL/README.md) for model details.

## Quick start

### Prerequisites

- Docker Desktop with Compose v2
- ~6 GB free disk (images + the Ollama and embedding model downloads)
- No GPU needed — the whole default stack runs on CPU

### Run the full stack

```powershell
# 1) create the root .env (gitignored)
copy .env.example .env

# 2) generate a JWT secret and paste the value into JWT_SECRET in .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"

# 3) (optional) for agentic chat mode, set GROQ_API_KEY in .env
#    free key at https://console.groq.com

# 4) build and start everything
docker compose up --build
```

`docker compose up --build` is the only command you need — it starts
`postgres`, `backend`, `client`, `model`, `ollama`, and the one-shot
`ollama-pull`. On the **first run**, `ollama-pull` downloads the generation
model (`qwen3.5:2b`) and `model` downloads the embedding/rerank models, so
allow a few minutes before the app is ready; later runs reuse the caches.

Then visit:

- App: <http://localhost:5173>
- API: <http://localhost:3000>
- Postgres: `localhost:5440` (user `doritos`, db `doritos`, password from `.env`)
- Embedding + rerank service: <http://localhost:5000>
- Ollama: <http://localhost:11434>

The backend container runs `prisma generate` and `prisma migrate deploy` on
startup — after Postgres reports healthy — so the schema is applied before
the API starts listening.

### Everyday commands

```powershell
docker compose up --build -d        # start in the background
docker compose logs -f backend      # follow one service's logs
docker compose ps                   # show service status
docker compose down                 # stop everything (data volumes kept)
docker compose down -v              # stop and wipe all data + model caches
```

### Run the dev stack with hot reload

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This override mounts `./BACKEND`, `./CLIENT`, and `./MODEL` into their
containers, runs the backend under `nodemon`, serves the client through
`vite dev` on port 5173, and runs `model` under uvicorn `--reload`. Edits on
the host reload immediately.

### Optional: fine-tuning UI

```powershell
docker compose --profile model up --build trainer
```

Starts the LLaMA-Factory web UI on <http://localhost:7860>. It is dormant by
default and most useful with an NVIDIA GPU — the GPU reservation is commented
out in `docker-compose.yml`.

### Running services on the host (no Docker)

You can also run the four pieces directly. Postgres still works easiest in
Docker:

```powershell
docker compose up postgres -d

# Backend
cd BACKEND
copy .env.example .env  # then fill in JWT_SECRET
npm install
npm run db:generate
npm run db:migrate      # one-time; uses prisma/migrations
npm start

# Client
cd ..\CLIENT
npm install --legacy-peer-deps
npm run dev

# Model (separate window; see MODEL/README.md)
cd ..\MODEL
python -m venv .venv
.\.venv\Scripts\activate
pip install -r requirements.txt
python server.py
```

### Optional: object segmentation (SAM2)

Attaching an image and selecting just one object to send to the model uses
**SAM2** running on a Modal GPU. It is optional — with `SEGMENT_API_URL` blank
the app runs normally and the "Select object" button stays hidden.

```powershell
pip install modal
modal token new
# one-time, if not already created:
modal secret create doritos-model-auth MODEL_API_KEY=<random-key>

modal deploy MODEL/modal_segment.py
```

Paste the URL `modal deploy` prints into `SEGMENT_API_URL` in `.env`, and set
the same `MODEL_API_KEY` there. The GPU is a T4 (~$0.59/hr) that scales to zero
when idle, so it costs roughly nothing between sessions.

## Project layout

```
.
├── BACKEND/              Express API, Prisma, JWT auth, file uploads
│   ├── lib/prisma.js     Prisma client singleton (uses @prisma/adapter-pg)
│   ├── middleware/       requireAuth, signToken, cookieOptions
│   ├── prisma/           schema.prisma + checked-in migrations
│   ├── prisma.config.ts  Prisma 7 config (datasource URL, schema, migrations dir)
│   ├── uploads/          multer disk storage (gitignored)
│   ├── index.js          all routes
│   └── Dockerfile
├── CLIENT/               React 19 SPA
│   ├── src/lib/auth.jsx  AuthProvider + useAuth, talks to /api/auth/me
│   ├── src/Routes/       HomePage, DashboardPage, ChatPage, SignInPage, SignUpPage
│   ├── src/components/   chatList, newPrompt, upload
│   ├── src/layouts/      rootLayout, dashboardLayout
│   ├── nginx.conf        SPA fallback for the prod stage
│   └── Dockerfile        deps -> dev | build -> prod stages
├── MODEL/                Local FastAPI inference server (Qwen2-VL)
│   ├── server.py         /generate, /set_model, /
│   ├── register_dataset.py  CLI for registering LLaMA-Factory datasets
│   ├── requirements.txt
│   ├── README.md
│   └── Dockerfile
├── docker-compose.yml      production-style stack (nginx, prisma migrate deploy)
├── docker-compose.dev.yml  override: hot reload, source volumes, vite dev
└── .env.example            root env vars compose interpolates
```

## API surface

All `/api/*` routes except `auth/register` and `auth/login` require a valid
JWT cookie issued by the auth endpoints.

| Method | Path | Notes |
|--------|------|-------|
| POST | `/api/auth/register` | `{ email, username, password }` — sets cookie |
| POST | `/api/auth/login` | `{ email, password }` — sets cookie |
| POST | `/api/auth/logout` | Clears cookie |
| GET  | `/api/auth/me` | Returns the current `{ id, email, username }` |
| POST | `/upload` | multipart `file` field; returns `{ fileUrl }` |
| GET  | `/uploads/:filename` | Static file server for uploaded images |
| POST | `/api/chats` | `{ text }` — creates a chat with the first turn |
| GET  | `/api/userchats` | List of `{ id, title, createdAt }` for the current user |
| GET  | `/api/chats/:id` | `{ id, title, messages: [...] }`, scoped to current user |
| PUT  | `/api/chats/:id` | Append a turn: `{ question, img? }` |
| POST | `/api/generate` | Pure passthrough to the inference server |

## Tech stack

| Layer | Choice |
|-------|--------|
| Frontend | React 19 (RC), Vite 5, Tanstack Query, react-router-dom 6, react-markdown, react-webcam |
| Backend  | Express 4 (ESM), Prisma 7 with `@prisma/adapter-pg`, bcryptjs, jsonwebtoken, cookie-parser, multer |
| Database | PostgreSQL 16 |
| Inference | FastAPI, transformers, qwen-vl-utils, PyTorch (CUDA when available) |
| Container | Docker + Docker Compose v2 |

## Notes

- The host port for Postgres is **5440**, not 5432, because most
  Postgres-hosting machines already have one or two local Postgres
  instances on the standard ports. Internal Docker networking still uses
  5432.
- Uploaded images live in a named Docker volume (`backend_uploads`).
- `prisma db push` is reserved for ad-hoc local exploration via
  `npm run db:push`; the canonical path is `prisma migrate dev` for
  authoring new migrations and `prisma migrate deploy` (run inside the
  backend container) for applying them.
