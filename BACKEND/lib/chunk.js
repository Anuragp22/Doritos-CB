const SEPARATORS = ['\n\n', '\n', '. ', '! ', '? ', '; ', ', ', ' ', ''];

function hardSplit(text, maxChars) {
  const out = [];
  for (let i = 0; i < text.length; i += maxChars) {
    out.push(text.slice(i, i + maxChars));
  }
  return out;
}

function splitRecursive(text, maxChars, sepIdx = 0) {
  if (text.length <= maxChars) return [text];

  while (sepIdx < SEPARATORS.length) {
    const sep = SEPARATORS[sepIdx];
    if (sep === '') return hardSplit(text, maxChars);
    if (text.includes(sep)) {
      const parts = text.split(sep);
      const out = [];
      for (const part of parts) {
        if (part.length === 0) continue;
        if (part.length <= maxChars) {
          out.push(part);
        } else {
          out.push(...splitRecursive(part, maxChars, sepIdx + 1));
        }
      }
      return out;
    }
    sepIdx++;
  }

  return hardSplit(text, maxChars);
}

function mergeAdjacent(parts, maxChars, overlap) {
  if (parts.length === 0) return [];
  const out = [];
  let current = '';
  const joiner = '\n';

  for (const part of parts) {
    const sep = current ? joiner : '';
    if (current && current.length + sep.length + part.length > maxChars) {
      out.push(current);
      const tail = overlap > 0 ? current.slice(-overlap) : '';
      current = tail ? `${tail}${joiner}${part}` : part;
    } else {
      current += sep + part;
    }
  }
  if (current) out.push(current);
  return out;
}

export function chunkText(text, maxChars = 1000, overlap = 100) {
  const normalized = text.replace(/\r\n/g, '\n').trim();
  if (!normalized) return [];
  if (normalized.length <= maxChars) return [normalized];

  const atoms = splitRecursive(normalized, maxChars);
  return mergeAdjacent(atoms, maxChars, overlap);
}
