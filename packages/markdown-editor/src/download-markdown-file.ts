/**
 * Symmetric counterpart to read-markdown-file.ts: turn editor text into a
 * downloadable `.md` file via the Blob -> object URL -> temporary anchor
 * idiom used elsewhere in the app (see PdfToMarkdownPanel's handleDownload).
 */

/**
 * Normalize a filename base for markdown download:
 *  1. Trim surrounding whitespace.
 *  2. Strip a trailing `.md`, `.markdown`, or `.txt` suffix (case-insensitive).
 *  3. Trim whitespace exposed by stripping the extension.
 *  4. Fall back to `'prompt'` when the result is empty.
 *  5. Append `.md`.
 */
export function markdownDownloadFilename(base: string): string {
  const trimmedBase = base.trim();
  const stripped = trimmedBase.replace(/\.(markdown|md|txt)$/i, '').trim();
  const name = stripped.length > 0 ? stripped : 'prompt';
  return `${name}.md`;
}

/**
 * Trigger a browser download of `text` as a `.md` file named from
 * `filenameBase` (normalized via `markdownDownloadFilename`).
 *
 * Accepts an optional `doc` (defaults to the global `document`) purely so
 * tests can inject a fake and assert on the anchor without touching the
 * real DOM.
 */
export function downloadMarkdownFile(text: string, filenameBase: string, doc: Document = document): void {
  const blob = new Blob([text], { type: 'text/markdown' });
  const href = URL.createObjectURL(blob);
  const anchor = doc.createElement('a');
  anchor.href = href;
  anchor.download = markdownDownloadFilename(filenameBase);
  anchor.click();
  URL.revokeObjectURL(href);
}
