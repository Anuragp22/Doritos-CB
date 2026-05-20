import { modelClient } from './modelClient.js';

const EMBED_API_URL = process.env.EMBED_API_URL || 'http://127.0.0.1:5000/embed';

export async function embed(inputs) {
  if (!inputs?.length) return [];
  const { data } = await modelClient.post(EMBED_API_URL, { inputs });
  return data.embeddings;
}
