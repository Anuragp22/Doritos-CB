# Document Ingestion Rebuild — Design

- **Date:** 2026-05-21
- **Status:** Approved
- **Topic:** Rebuild document ingestion so large uploads process asynchronously without blocking, timing out, or exhausting memory.

## Context

The current `POST /api/documents` handler is demo-grade and fails on large documents:

- **5 MB cap**, `memoryStorage` — the whole file sits in RAM.
- **Fully synchronous** — extraction + embedding + insertion all run inside the HTTP request, which times out (~30–120 s) on anything sizeable, leaving half-ingested state.
- **Single mega embed call** — `embed(chunks)` sends *every* chunk in one HTTP POST; the CPU embedder processes them all in one pass.
- **Per-chunk INSERT loop** — one DB round-trip per chunk.
- **No status, no failure cleanup** — a crash leaves an orphaned `Document` with missing chunks.

## Goal

Uploading a large document (hundreds of pages) succeeds: the request returns instantly, processing runs in the background with bounded memory, and the UI reflects `processing` → `ready`/`failed`. Only the ingestion path changes — retrieval is untouched.

## Non-goals

- No retry button — a `failed` document is deleted and re-uploaded.
- No external job queue / Redis — in-process async, per the approved decision.
- No changes to chunking strategy, embeddings, retrieval, or generation.
- No streaming PDF extraction — extraction buffers one file at a time (accepted ceiling).

## Architecture

Upload becomes **non-blocking**. The HTTP handler validates the file, writes a `Document` row as `processing`, responds `202`, and hands off to a background processor in the **same Node process**. An in-process FIFO queue processes **one document at a time** (serial), so concurrent uploads never thrash the CPU embedder or pile up in RAM. A `status` field on `Document` is the single source of truth; the frontend polls it.

## Components & changes

### 1. Upload endpoint — `POST /api/documents` (`BACKEND/index.js`)

- multer `docUpload`: `memoryStorage` → **`diskStorage`** (file streams to a temp file under `uploads/`), `limits.fileSize` = `MAX_UPLOAD_MB * 1024 * 1024` with **`MAX_UPLOAD_MB = 500`** (a named constant).
- Handler:
  1. `if (!req.file)` → `400`.
  2. Create `Document` row: `{ userId, filename, contentType, status: 'processing' }`.
  3. Respond **`202`** with `{ id, filename, status: 'processing' }`.
  4. `enqueueIngest({ documentId, filePath: req.file.path, originalname, mimetype })` — **not awaited**.
- **multer error handling** — an over-limit file raises `MulterError(LIMIT_FILE_SIZE)`. An error-handling middleware maps it to a clean **`413`** (`{ error: 'File exceeds the 500 MB limit' }`) instead of a generic 500.

### 2. Background processor — `BACKEND/lib/ingest.js` (new)

- Module-level FIFO queue + single-worker flag. `enqueueIngest(job)` pushes and triggers `drainQueue()`; `drainQueue()` processes jobs one at a time.
- `processOne({ documentId, filePath, originalname, mimetype })`:
  1. **try:** `extractText` → `chunkText` → for each **batch of `EMBED_BATCH_SIZE = 64`** chunks: `embed(batch)` then **bulk-insert that batch** (multi-row raw INSERT, `::vector` cast). Embeddings are never all held at once. → `Document` `status: 'ready'`, `chunkCount: total`.
  2. **catch:** log; delete any `DocumentChunk` rows already written for this document (clean failed state); `Document` `status: 'failed'`, `error: <message>`.
  3. **finally:** `fs.unlink(filePath)` — remove the temp upload file.
- Exposes a pure `batches(array, size)` helper (unit-testable).

### 3. `BACKEND/lib/extract.js`

`extractText(file)` currently reads `file.buffer` (only present with `memoryStorage`). Change: resolve the buffer from either source at the top —
`const buffer = file.buffer ?? await fs.readFile(file.path)` — then the existing PDF/DOCX/HTML/text extractors are unchanged. Backwards-compatible.

### 4. Data model — `BACKEND/prisma/schema.prisma` + migration

`Document` gains three fields:

| Field | Type | Notes |
|---|---|---|
| `status` | `String @default("processing")` | `processing` \| `ready` \| `failed` |
| `chunkCount` | `Int @default(0)` | populated on success |
| `error` | `String?` | failure message |

New migration also **backfills existing rows**: `UPDATE "Document" SET status='ready', "chunkCount"=(SELECT COUNT(*) FROM "DocumentChunk" c WHERE c."documentId" = "Document".id)` — pre-existing documents are already processed, so they must not show as `processing`.

### 5. Startup recovery — `BACKEND/index.js` `start()`

After `prisma.$connect()`: `updateMany` any `status: 'processing'` rows → `status: 'failed'`, `error: 'Processing interrupted by a server restart.'` A job killed by a crash surfaces as `failed` (re-uploadable) instead of being stuck forever. Log the count.

### 6. `GET /api/documents`

Ensure the response includes `status`, `chunkCount`, and `error` for each document.

### 7. Frontend — `CLIENT/src/Routes/DocumentsPage/DocumentsPage.jsx`

- Upload now returns `202` `{ status: 'processing' }` (was `201` `{ chunks }`) — the document appears in the list immediately with a **"Processing…"** badge.
- Render per status: `processing` → badge + spinner; `ready` → chunk count; `failed` → error badge + message.
- **Poll** `GET /api/documents` every ~4 s while any document is `processing`; stop when none are.

## Data flow

1. `POST /api/documents` → file streamed to disk → `Document(processing)` created → `202` returned → job enqueued.
2. Worker: extract → chunk → embed in batches of 64, bulk-inserting each batch → `status: ready`, `chunkCount`.
3. Frontend polls, sees `ready`, stops polling.
4. Failure at any step → partial chunks deleted, `status: failed` + `error`; temp file always removed.

## Memory profile (why 500 MB is safe)

- `diskStorage` — uploads stream to disk; concurrent uploads do not accumulate in RAM.
- Serial processing — only one document's memory is live at a time.
- Extraction still buffers one file (`fs.readFile`) plus the extracted text and chunk arrays — transient peak for a 500 MB file is the binding constraint, comfortably within 16 GB.
- Embedding is batched and inserted incrementally — bounded regardless of document size; a larger document simply takes longer.

## Error handling

- Over-limit upload → `413`.
- Unsupported file type → `extractText` throws → caught → `status: failed`.
- Empty extraction (0 chunks) → `status: failed`, `error: 'No extractable text'`.
- Embedder/DB error mid-batch → caught → partial chunks deleted → `status: failed`.
- Server restart mid-job → startup recovery marks it `failed`.

## Testing

- **Unit (`node --test`):** the pure `batches(array, size)` helper.
- **Integration:** upload a large multi-hundred-page document → observe `processing` → `ready` with a correct chunk count and a still-responsive server; upload an unsupported file → `failed` with a message.

## Build sequence

1. Schema + migration (`status`/`chunkCount`/`error` + backfill).
2. `extract.js` — disk-path buffer resolution.
3. `ingest.js` — background processor + queue + `batches` helper.
4. `index.js` — upload handler (diskStorage, `202`, enqueue), multer `413` handling, startup recovery.
5. `GET /api/documents` — include the new fields.
6. `DocumentsPage.jsx` — status badges + polling.
7. End-to-end verification.
