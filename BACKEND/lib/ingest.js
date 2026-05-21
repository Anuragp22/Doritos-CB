import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import prismaPkg from '@prisma/client';
import prisma from './prisma.js';
import { extractSegments } from './extract.js';
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

// Prepend a lightweight source label so each chunk is self-contained — a
// no-LLM approximation of Anthropic's Contextual Retrieval. The label is
// stored in `text`, so it is embedded and full-text indexed with the body.
export function contextualize(text, filename, page) {
  const label = page ? `${filename} · p.${page}` : filename;
  return `[${label}] ${text}`;
}

// sha256 of the file, streamed so a large upload is never fully resident.
function hashFile(filePath) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
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

async function processOne({ documentId, filePath, originalname, mimetype, userId }) {
  try {
    const contentHash = await hashFile(filePath);

    // Content-addressed dedup: if this user already has a fully-ingested
    // document with the same bytes AND the same filename, copy its chunks
    // instead of re-running the embedder. Matching the filename too keeps the
    // copied chunks' contextual labels correct.
    const twin = await prisma.document.findFirst({
      where: {
        userId,
        contentHash,
        filename: originalname,
        status: 'ready',
        id: { not: documentId },
      },
      select: { id: true },
    });
    if (twin) {
      await prisma.documentChunk.deleteMany({ where: { documentId } });
      await prisma.$executeRaw`
        INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", "text", "embedding")
        SELECT gen_random_uuid()::text, ${documentId}, "chunkIndex", "text", "embedding"
        FROM "DocumentChunk"
        WHERE "documentId" = ${twin.id}
      `;
      await prisma.document.update({
        where: { id: documentId },
        data: { status: 'ready', contentHash },
      });
      return;
    }

    // Fresh ingest. Drop any partial chunks first so a re-run is idempotent.
    await prisma.documentChunk.deleteMany({ where: { documentId } });

    let written = 0;
    for await (const segment of extractSegments({ path: filePath, originalname, mimetype })) {
      const chunks = chunkText(segment.text);
      for (const batch of batches(chunks, EMBED_BATCH_SIZE)) {
        const texts = batch.map((t) => contextualize(t, originalname, segment.page));
        const embeddings = await embed(texts);
        const rows = texts.map((text, i) => {
          const vec = `[${embeddings[i].join(',')}]`;
          return Prisma.sql`(${randomUUID()}, ${documentId}, ${written + i}, ${text}, ${vec}::vector)`;
        });
        await prisma.$executeRaw`
          INSERT INTO "DocumentChunk" (id, "documentId", "chunkIndex", text, embedding)
          VALUES ${Prisma.join(rows)}
        `;
        written += batch.length;
      }
    }

    if (written === 0) throw new Error('No extractable text in file');

    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'ready', contentHash },
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
