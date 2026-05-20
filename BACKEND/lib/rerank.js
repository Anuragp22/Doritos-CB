import { modelClient } from './modelClient.js';

const RERANK_API_URL = process.env.RERANK_API_URL || 'http://127.0.0.1:5000/rerank';

export async function rerank(query, candidates, topK) {
  if (!candidates?.length) return [];
  const { data } = await modelClient.post(RERANK_API_URL, {
    query,
    documents: candidates.map((c) => c.text),
    top_k: topK,
  });
  return data.indices.map((idx, rank) => ({
    ...candidates[idx],
    rerankScore: data.scores[rank],
  }));
}
