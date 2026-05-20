import fs from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import prismaPkg from '@prisma/client';
import prisma from './prisma.js';
import { extractText } from './extract.js';
import { chunkText } from './chunk.js';
import { embed } from './embed.js';

// @prisma/client v7 is CommonJS — destructure the namespace from the default
// import (same interop pattern as lib/prisma.js).
const { Prisma } = prismaPkg;

const EMBED_BATCH_SIZE = 64;

// Split an array into consecutive batches of at most `size`. Pure helper.
export function batches(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// In-process FIFO queue with a single worker, so two large uploads never
// process concurrently and thrash the CPU embedder.
const queue = [];
let working = false;

export function enqueueIngest(job) {
  queue.push(job);
  drainQueue();
}

async function drainQueue() {
  if (working) return;
  working = true;
  while (queue.length) {
    const job = queue.shift();
    await processOne(job).catch((err) => console.error('Ingest worker error:', err));
  }
  working = false;
}

async function processOne({ documentId, filePath, originalname, mimetype }) {
  try {
    const text = await extractText({ path: filePath, originalname, mimetype });
    const chunks = chunkText(text);
    if (chunks.length === 0) throw new Error('No extractable text in file');

    let written = 0;
    for (const batch of batches(chunks, EMBED_BATCH_SIZE)) {
      const embeddings = await embed(batch);
      const rows = batch.map((textChunk, i) => {
        const vec = `[${embeddings[i].join(',')}]`;
        return Prisma.sql`(${randomUUID()}, ${documentId}, ${written + i}, ${textChunk}, ${vec}::vector)`;
      });
      await prisma.$executeRaw`
        INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", text, embedding)
        VALUES ${Prisma.join(rows)}
      `;
      written += batch.length;
    }

    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'ready' },
    });
  } catch (err) {
    console.error(`Ingest failed for document ${documentId}:`, err.message);
    await prisma.documentChunk.deleteMany({ where: { documentId } }).catch(() => {});
    await prisma.document
      .update({
        where: { id: documentId },
        data: { status: 'failed', error: err.message.slice(0, 500) },
      })
      .catch(() => {});
  } finally {
    await fs.unlink(filePath).catch(() => {});
  }
}
