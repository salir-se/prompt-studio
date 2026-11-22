/** Maximum file size accepted for markdown uploads (512 KiB). */
export const MAX_PROMPT_UPLOAD_BYTES = 512 * 1024;

/** File extensions considered markdown/plain text. Extension check is primary
 *  because some operating systems report an empty `type` for `.md` files. */
export const ACCEPTED_MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.txt'] as const;

/** MIME types we accept when the extension alone is not decisive. */
export const ACCEPTED_MARKDOWN_MIME_TYPES = ['text/markdown', 'text/x-markdown'] as const;

export type MarkdownUploadErrorCode = 'UNSUPPORTED_TYPE' | 'TOO_LARGE' | 'BINARY' | 'READ_FAILED';

/** Typed upload rejection carrying a machine-readable code and a user message. */
export class MarkdownUploadError extends Error {
  readonly code: MarkdownUploadErrorCode;

  constructor(code: MarkdownUploadErrorCode, message: string) {
    super(message);
    this.name = 'MarkdownUploadError';
    this.code = code;
  }
}

export interface MarkdownFileContent {
  text: string;
  name: string;
}

/**
 * Returns true when the file is considered a markdown/plain-text file we accept.
 *
 * Extension is the primary signal (lowercased comparison against
 * `ACCEPTED_MARKDOWN_EXTENSIONS`). When the extension does not match, we fall
 * back to `file.type` (lowercased) against `ACCEPTED_MARKDOWN_MIME_TYPES`.
 */
export function isAcceptedMarkdownFile(file: File): boolean {
  const lower = file.name.toLowerCase();
  for (const ext of ACCEPTED_MARKDOWN_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  const mime = file.type.toLowerCase();
  for (const allowed of ACCEPTED_MARKDOWN_MIME_TYPES) {
    if (mime === allowed) return true;
  }
  return false;
}

/**
 * Derive a friendly label from a filename:
 *  1. Strip leading path segments (everything up to and including the last `/` or `\`).
 *  2. Strip a trailing `.md`, `.markdown`, or `.txt` suffix (case-insensitive).
 *  3. Trim surrounding whitespace.
 *  4. Cap to 60 characters.
 */
export function suggestedLabelFromFilename(name: string): string {
  // 1. Basename
  const slashIdx = Math.max(name.lastIndexOf('/'), name.lastIndexOf('\\'));
  const base = slashIdx >= 0 ? name.slice(slashIdx + 1) : name;

  // 2. Trim first so trailing whitespace doesn't mask the extension
  const trimmedBase = base.trim();

  // 3. Strip recognised extensions (longest first to avoid partial strip)
  const extPattern = /\.(markdown|md|txt)$/i;
  const trimmed = trimmedBase.replace(extPattern, '').trim();

  // 4. Cap
  return trimmed.slice(0, 60);
}

/** Read a File as text using FileReader (fallback for environments without File.text()). */
function readViaFileReader(file: File): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('FileReader error'));
    reader.readAsText(file);
  });
}

/**
 * Validate and read a markdown file to text.
 *
 * Rejection order:
 *  1. Unsupported file type → `UNSUPPORTED_TYPE`
 *  2. File too large (> 512 KiB) → `TOO_LARGE`
 *  3. Read failure → `READ_FAILED`
 *  4. NUL byte in content (binary file) → `BINARY`
 *
 * Returns `{ text, name }` on success. Empty text is valid.
 */
export async function readMarkdownFile(file: File): Promise<MarkdownFileContent> {
  // 1. Type check
  if (!isAcceptedMarkdownFile(file)) {
    throw new MarkdownUploadError('UNSUPPORTED_TYPE', 'Please upload a markdown file (.md, .markdown, or .txt).');
  }

  // 2. Size check (uses the constant so the message stays in sync)
  const maxKb = MAX_PROMPT_UPLOAD_BYTES / 1024;
  if (file.size > MAX_PROMPT_UPLOAD_BYTES) {
    throw new MarkdownUploadError('TOO_LARGE', `File is too large (max ${maxKb} KB).`);
  }

  // 3. Read text
  let text: string;
  try {
    if (typeof (file as { text?: unknown }).text === 'function') {
      text = await file.text();
    } else {
      text = await readViaFileReader(file);
    }
  } catch {
    throw new MarkdownUploadError('READ_FAILED', 'Could not read the file. Please try again.');
  }

  // 4. Binary check — NUL byte signals a binary file given a .md name
  if (text.includes('\x00')) {
    throw new MarkdownUploadError('BINARY', 'This file looks binary, not markdown text.');
  }

  return { text, name: file.name };
}
