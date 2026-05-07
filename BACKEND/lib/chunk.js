export function chunkText(text, maxChars = 1000, overlap = 100) {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (normalized.length === 0) return [];
  if (normalized.length <= maxChars) return [normalized];

  const chunks = [];
  let start = 0;
  while (start < normalized.length) {
    const end = Math.min(start + maxChars, normalized.length);
    chunks.push(normalized.slice(start, end));
    if (end >= normalized.length) break;
    start = end - overlap;
  }
  return chunks;
}
