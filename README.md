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
        +----------------+        +------------------+
Browser | CLIENT (Vite + |  fetch | BACKEND (Express)|
  ----> | React, port    |  ----> | port 3000        |
        | 5173 dev /     |        | JWT cookie auth  |
        | 80 prod nginx) |        | Prisma ORM       |
        +----------------+        +---------+--------+
                                            |
                            +---------------+----------+
                            |                          |
                +-----------v---------+    +-----------v---------+
                | Postgres (5440)     |    | MODEL (port 5000)   |
                | Prisma migrations:  |    | FastAPI + Qwen2-VL  |
                | User, Chat, Message |    | inference server    |
                +---------------------+    +---------------------+
```

| Service | Tech | Container port | Host port |
|---------|------|----------------|-----------|
| `client` | React 19 + Vite + Tanstack Query | 5173 (dev) / 80 (prod nginx) | 5173 |
| `backend` | Express + Prisma + bcrypt + JWT | 3000 | 3000 |
| `postgres` | postgres:16-alpine | 5432 | **5440** |
| `model` | FastAPI + transformers + Qwen2-VL | 5000 | 5000 |

The `model` service is gated behind a Compose profile because it needs an
NVIDIA GPU to be useful in practice. See [`MODEL/README.md`](MODEL/README.md)
for setup.

## Quick start

### Prerequisites

- Docker Desktop with Compose v2
- (Optional, for the `model` service) NVIDIA GPU + NVIDIA Container Toolkit

### Run the production-style stack

```powershell
# 1) create the root .env (gitignored) — at minimum supply JWT_SECRET
copy .env.example .env
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
# paste the value into JWT_SECRET in .env

# 2) bring everything up
docker compose up --build

# 3) (optional) start the inference server too — needs a GPU
docker compose --profile model up --build
```

Then visit:

- App: <http://localhost:5173>
- API: <http://localhost:3000>
- Postgres: `localhost:5440` (user `doritos`, db `doritos`, password from `.env`)
- Inference server: <http://localhost:5000>

The backend container runs `prisma migrate deploy` on startup, so the schema
is applied to the freshly created Postgres before the server starts listening.

### Run the dev stack with hot reload

```powershell
docker compose -f docker-compose.yml -f docker-compose.dev.yml up
```

This override mounts `./BACKEND` and `./CLIENT` into their containers, runs
the backend under `nodemon`, and serves the client through `vite dev`. Edits
on the host reload immediately.

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
