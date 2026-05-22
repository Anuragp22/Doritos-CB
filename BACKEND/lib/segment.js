import { randomBytes } from 'node:crypto';
import path from 'node:path';

// True when the SAM2 Modal deployment is configured. The segment routes and
// the client's "Select object" button are both gated on this.
export function segmentEnabled() {
  return Boolean(process.env.SEGMENT_API_URL);
}

// Collision-resistant filename for a saved cutout: keeps the original image's
// base name and always ends in .png (cutouts are PNG).
export function cutoutFilename(originalName) {
  const name = originalName || 'image';
  const base = path.basename(name, path.extname(name));
  const safe = base.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 40) || 'image';
  return `${safe}-cutout-${randomBytes(6).toString('hex')}.png`;
}

// Decode a base64 PNG payload (with or without a data: URI prefix) to a Buffer.
export function decodeBase64Png(payload) {
  if (typeof payload !== 'string' || !payload) {
    throw new Error('cutout payload is empty');
  }
  const comma = payload.indexOf(',');
  const b64 = payload.startsWith('data:') && comma !== -1
    ? payload.slice(comma + 1)
    : payload;
  return Buffer.from(b64, 'base64');
}
