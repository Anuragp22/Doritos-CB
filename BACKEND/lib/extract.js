import path from 'path';
import fs from 'node:fs/promises';
import mammoth from 'mammoth';
import { extractText as extractPdfText, getDocumentProxy } from 'unpdf';
import { load as loadHtml } from 'cheerio';

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.markdown', '.mdx', '.rst', '.adoc',
  '.csv', '.tsv', '.json', '.jsonl', '.yaml', '.yml', '.toml', '.ini',
  '.xml', '.log',
  '.py', '.js', '.mjs', '.cjs', '.ts', '.tsx', '.jsx',
  '.go', '.rs', '.java', '.kt', '.swift',
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hpp',
  '.cs', '.fs', '.vb',
  '.rb', '.php', '.pl', '.lua',
  '.sh', '.bash', '.zsh', '.fish', '.ps1',
  '.sql', '.graphql', '.proto',
  '.tex', '.bib',
]);

async function extractPdf(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  const { text } = await extractPdfText(pdf, { mergePages: true });
  return text || '';
}

async function extractDocx(buffer) {
  const { value } = await mammoth.extractRawText({ buffer });
  return value || '';
}

function extractHtml(buffer) {
  const $ = loadHtml(buffer.toString('utf8'));
  $('script, style, noscript').remove();
  return $('body').text() || $.root().text();
}

export async function extractText(file) {
  const filename = file.originalname || 'upload';
  const ext = path.extname(filename).toLowerCase();
  const mime = file.mimetype || '';
  // Resolve bytes from an in-memory buffer (memoryStorage) or a disk path
  // (diskStorage). Disk-based uploads only carry a path.
  const buffer = file.buffer ?? (await fs.readFile(file.path));

  if (ext === '.pdf' || mime === 'application/pdf') {
    return extractPdf(buffer);
  }
  if (
    ext === '.docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    return extractDocx(buffer);
  }
  if (ext === '.html' || ext === '.htm' || mime === 'text/html') {
    return extractHtml(buffer);
  }
  if (TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/') || mime === 'application/json') {
    return buffer.toString('utf8');
  }

  throw new Error(`Unsupported file type: ${ext || mime || 'unknown'}`);
}

export const SUPPORTED_EXTENSIONS = [
  ...Array.from(TEXT_EXTENSIONS),
  '.pdf',
  '.docx',
  '.html',
  '.htm',
];
