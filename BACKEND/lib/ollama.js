import axios from 'axios';

// Adapter for a local Ollama service. Generation (text + vision) runs here;
// embeddings/reranking stay on MODEL/server.py and are not handled in this file.
const OLLAMA_URL = process.env.OLLAMA_URL || 'http://localhost:11434';
const GEN_MODEL = process.env.GEN_MODEL || 'qwen3.5:2b';

// Convert the backend's internal message format
//   { role, content: [{ type: 'text', text }, { type: 'image', image }] }
// into Ollama's /api/chat shape
//   { role, content: <joined text>, images?: [<base64>] }
export function toOllamaMessages(messages) {
  return messages.map((m) => {
    const role = m.role === 'model' ? 'assistant' : m.role;
    const parts = Array.isArray(m.content)
      ? m.content
      : [{ type: 'text', text: String(m.content ?? '') }];
    const content = parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text || '')
      .join('\n');
    const images = parts
      .filter((p) => p.type === 'image' && p.image)
      .map((p) => p.image.replace(/^data:[^;]+;base64,/, ''));
    const msg = { role, content };
    if (images.length) msg.images = images;
    return msg;
  });
}

// Stream a chat completion. Async generator yielding text deltas.
export async function* streamChat(messages, { signal } = {}) {
  const resp = await axios.post(
    `${OLLAMA_URL}/api/chat`,
    { model: GEN_MODEL, messages: toOllamaMessages(messages), stream: true },
    { responseType: 'stream', signal }
  );

  let buffer = '';
  for await (const chunk of resp.data) {
    buffer += chunk.toString();
    const lines = buffer.split('\n');
    buffer = lines.pop() || '';
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      let parsed;
      try {
        parsed = JSON.parse(trimmed);
      } catch {
        continue;
      }
      if (parsed.error) throw new Error(parsed.error);
      const delta = parsed.message?.content;
      if (delta) yield delta;
    }
  }
}

// Non-streaming single-shot generation. Returns the full text.
export async function generateOnce({ user_text, image_url }) {
  const content = [];
  if (image_url) content.push({ type: 'image', image: image_url });
  if (user_text) content.push({ type: 'text', text: user_text });
  const { data } = await axios.post(`${OLLAMA_URL}/api/chat`, {
    model: GEN_MODEL,
    messages: toOllamaMessages([{ role: 'user', content }]),
    stream: false,
  });
  return data.message?.content ?? '';
}
