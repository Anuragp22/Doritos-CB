import { GoogleGenAI } from '@google/genai';

// Gemini vision path. Chat turns that carry an image are routed here: the
// offline model is vision-capable but slow on CPU, and the Groq agent model is
// text-only. Gemini 2.5 Flash is a fast multimodal model.

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

const SYSTEM_PROMPT =
  'You are the assistant for the Doritos AI workspace. The user has attached ' +
  'an image. If they asked a question, answer it clearly and concisely; if ' +
  'they did not ask anything, briefly describe what the image shows.';

// Split a `data:<mime>;base64,<data>` URI into a Gemini inlineData part.
function dataUriToPart(uri) {
  const m = /^data:([^;]+);base64,(.*)$/s.exec(uri || '');
  return m ? { inlineData: { mimeType: m[1], data: m[2] } } : null;
}

// Convert the backend's internal message format
//   { role, content: [{ type:'text', text }, { type:'image', image }] }
// into Gemini `contents` (roles are 'user' / 'model').
function toGeminiContents(messages) {
  const out = [];
  for (const msg of messages) {
    const role =
      msg.role === 'model' || msg.role === 'assistant' ? 'model' : 'user';
    const blocks = Array.isArray(msg.content)
      ? msg.content
      : [{ type: 'text', text: String(msg.content ?? '') }];
    const parts = [];
    for (const b of blocks) {
      if (b.type === 'image') {
        const part = dataUriToPart(b.image);
        if (part) parts.push(part);
      } else if (b.text) {
        parts.push({ text: b.text });
      }
    }
    if (parts.length) out.push({ role, parts });
  }
  return out;
}

// Stream a Gemini answer for a conversation that includes an image.
// Yields text deltas.
export async function* streamVisionAnswer(messages, { signal } = {}) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error(
      'GEMINI_API_KEY is not set — image chat needs a Gemini API key in .env.'
    );
  }

  const ai = new GoogleGenAI({ apiKey });
  const response = await ai.models.generateContentStream({
    model: GEMINI_MODEL,
    contents: toGeminiContents(messages),
    config: { systemInstruction: SYSTEM_PROMPT, abortSignal: signal },
  });

  for await (const chunk of response) {
    const text = chunk.text;
    if (text) yield text;
  }
}
