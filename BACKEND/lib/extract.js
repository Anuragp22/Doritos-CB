import path from 'path';
import fs from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import mammoth from 'mammoth';
import { getDocumentProxy } from 'unpdf';
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

// Yield one segment per PDF page. PDF.js needs the whole file in memory (it
// does random access), but extracting and releasing page by page keeps the
// rest of the pipeline from ever holding the full document text at once.
async function* extractPdfSegments(buffer) {
  const pdf = await getDocumentProxy(new Uint8Array(buffer));
  try {
    for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
      const page = await pdf.getPage(pageNum);
      const content = await page.getTextContent();
      const text = content.items
        .filter((item) => 'str' in item)
        .map((item) => item.str + (item.hasEOL ? '\n' : ''))
        .join('');
      page.cleanup();
      yield { text, page: pageNum };
    }
  } finally {
    await pdf.destroy();
  }
}

// Stream a plain-text file in bounded, newline-aligned segments. Memory stays
// capped at roughly one segment, and breaking only at newlines keeps CSV rows
// and JSONL records intact instead of cutting them mid-token.
async function* extractTextFileSegments(filePath) {
  const SEGMENT_TARGET = 256 * 1024; // aim for ~256 KB per segment
  const HARD_CAP = SEGMENT_TARGET * 4; // flush even a newline-free run here
  const stream = createReadStream(filePath, { encoding: 'utf8' });
  let buffer = '';

  for await (const block of stream) {
    buffer += block;
    while (buffer.length >= SEGMENT_TARGET) {
      const cut = buffer.lastIndexOf('\n');
      if (cut > 0) {
        yield { text: buffer.slice(0, cut), page: null };
        buffer = buffer.slice(cut + 1);
      } else if (buffer.length >= HARD_CAP) {
        // A single line longer than the hard cap (e.g. minified JSON) has no
        // clean split point — flush what we have rather than grow unbounded.
        yield { text: buffer, page: null };
        buffer = '';
      } else {
        break; // wait for more input to reach a newline
      }
    }
  }
  if (buffer) yield { text: buffer, page: null };
}

// Streaming text extraction. Yields `{ text, page }` segments — `page` is the
// 1-based page number for PDFs, `null` for formats without a page concept.
// The ingest worker chunks/embeds/inserts each segment before the next is
// pulled, so memory stays bounded by a single segment regardless of file size.
export async function* extractSegments(file) {
  const filename = file.originalname || 'upload';
  const ext = path.extname(filename).toLowerCase();
  const mime = file.mimetype || '';

  if (ext === '.pdf' || mime === 'application/pdf') {
    const buffer = await fs.readFile(file.path);
    yield* extractPdfSegments(buffer);
    return;
  }

  if (
    ext === '.docx' ||
    mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  ) {
    // mammoth needs the whole buffer; emit it as a single segment.
    const buffer = await fs.readFile(file.path);
    const { value } = await mammoth.extractRawText({ buffer });
    yield { text: value || '', page: null };
    return;
  }

  if (ext === '.html' || ext === '.htm' || mime === 'text/html') {
    const buffer = await fs.readFile(file.path);
    const $ = loadHtml(buffer.toString('utf8'));
    $('script, style, noscript').remove();
    yield { text: $('body').text() || $.root().text(), page: null };
    return;
  }

  if (TEXT_EXTENSIONS.has(ext) || mime.startsWith('text/') || mime === 'application/json') {
    yield* extractTextFileSegments(file.path);
    return;
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
