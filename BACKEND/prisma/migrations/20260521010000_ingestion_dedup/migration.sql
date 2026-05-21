-- Content-addressed dedup: a sha256 of the uploaded file lets identical
-- re-uploads (same bytes + same filename) reuse the existing embeddings
-- instead of re-running the embedder.
ALTER TABLE "Document" ADD COLUMN "contentHash" TEXT;

-- Speeds up the dedup lookup (userId + contentHash) done at ingest time.
CREATE INDEX "Document_userId_contentHash_idx" ON "Document"("userId", "contentHash");

-- A document's chunk indices are a contiguous 0..N-1 sequence. The unique
-- constraint makes the dedup chunk-copy fail loudly instead of silently
-- duplicating a row.
CREATE UNIQUE INDEX "DocumentChunk_documentId_chunkIndex_key"
    ON "DocumentChunk"("documentId", "chunkIndex");
