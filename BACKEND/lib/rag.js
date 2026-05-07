import prisma from './prisma.js';
import { embed } from './embed.js';

const VECTOR_CANDIDATES = 20;
const FTS_CANDIDATES = 20;
const RRF_K = 60;
const TOP_K = 5;

export async function hybridRetrieve(query, userId, topK = TOP_K) {
  const [embedding] = await embed([query]);
  if (!embedding) return [];

  const vectorLiteral = `[${embedding.join(',')}]`;

  const rows = await prisma.$queryRaw`
    WITH semantic AS (
      SELECT c.id,
             ROW_NUMBER() OVER (ORDER BY c.embedding <=> ${vectorLiteral}::vector) AS r
      FROM "DocumentChunk" c
      JOIN "Document" d ON d.id = c."documentId"
      WHERE d."userId" = ${userId} AND c.embedding IS NOT NULL
      ORDER BY c.embedding <=> ${vectorLiteral}::vector
      LIMIT ${VECTOR_CANDIDATES}
    ),
    fts AS (
      SELECT c.id,
             ROW_NUMBER() OVER (
               ORDER BY ts_rank_cd(c.tsv, plainto_tsquery('english', ${query})) DESC
             ) AS r
      FROM "DocumentChunk" c
      JOIN "Document" d ON d.id = c."documentId"
      WHERE d."userId" = ${userId}
        AND c.tsv @@ plainto_tsquery('english', ${query})
      ORDER BY ts_rank_cd(c.tsv, plainto_tsquery('english', ${query})) DESC
      LIMIT ${FTS_CANDIDATES}
    )
    SELECT c.id,
           c.text,
           c."documentId" AS "documentId",
           d.filename,
           COALESCE(1.0 / (${RRF_K} + s.r), 0) +
           COALESCE(1.0 / (${RRF_K} + f.r), 0) AS score
    FROM "DocumentChunk" c
    JOIN "Document" d ON d.id = c."documentId"
    LEFT JOIN semantic s ON s.id = c.id
    LEFT JOIN fts f ON f.id = c.id
    WHERE s.id IS NOT NULL OR f.id IS NOT NULL
    ORDER BY score DESC
    LIMIT ${topK};
  `;

  return rows;
}

export function buildAugmentedPrompt(query, retrievedChunks) {
  if (!retrievedChunks?.length) return query;
  const context = retrievedChunks
    .map((c, i) => `[${i + 1}] (${c.filename}) ${c.text}`)
    .join('\n\n');
  return `Use the following reference passages from the user's documents to answer the question. If the answer is not in the passages, say so.

${context}

Question: ${query}`;
}
