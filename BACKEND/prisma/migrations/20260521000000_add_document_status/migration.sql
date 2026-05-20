-- Adds async-ingestion status tracking to Document.
ALTER TABLE "Document" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'processing';
ALTER TABLE "Document" ADD COLUMN "error" TEXT;

-- Existing documents predate async ingestion; they are already processed.
UPDATE "Document" SET "status" = 'ready';
