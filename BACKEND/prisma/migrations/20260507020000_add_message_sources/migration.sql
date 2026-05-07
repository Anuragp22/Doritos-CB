-- Add sources column for RAG citation metadata
ALTER TABLE "Message" ADD COLUMN "sources" JSONB;
