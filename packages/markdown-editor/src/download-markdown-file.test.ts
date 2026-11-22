// @module-tag dom
/**
 * BDD coverage for download-markdown-file utilities (symmetric counterpart to
 * read-markdown-file.test.ts):
 *   - markdownDownloadFilename: trim -> strip trailing .md/.markdown/.txt -> fallback 'prompt' -> append .md
 *   - downloadMarkdownFile: Blob -> object URL -> temporary anchor -> click -> revoke
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadMarkdownFile, markdownDownloadFilename } from './download-markdown-file';

// ---------------------------------------------------------------------------
// markdownDownloadFilename
// ---------------------------------------------------------------------------

describe('markdownDownloadFilename', () => {
  it('appends .md to a plain base', () => {
    expect(markdownDownloadFilename('notes')).toBe('notes.md');
  });

  it('strips a trailing .md extension', () => {
    expect(markdownDownloadFilename('notes.md')).toBe('notes.md');
  });

  it('strips a trailing .markdown extension case-insensitively', () => {
    expect(markdownDownloadFilename('notes.MARKDOWN')).toBe('notes.md');
  });

  it('strips a trailing .txt extension', () => {
    expect(markdownDownloadFilename('notes.TXT')).toBe('notes.md');
  });

  it('trims leading/trailing whitespace', () => {
    expect(markdownDownloadFilename('  notes  ')).toBe('notes.md');
  });

  it('trims whitespace exposed after stripping the extension', () => {
    expect(markdownDownloadFilename('notes  .md')).toBe('notes.md');
  });

  it('falls back to "prompt" for an empty string', () => {
    expect(markdownDownloadFilename('')).toBe('prompt.md');
  });

  it('falls back to "prompt" for a whitespace-only string', () => {
    expect(markdownDownloadFilename('   ')).toBe('prompt.md');
  });

  it('falls back to "prompt" when the base is only a recognised extension', () => {
    expect(markdownDownloadFilename('.md')).toBe('prompt.md');
  });

  it('preserves a name with no extension', () => {
    expect(markdownDownloadFilename('README')).toBe('README.md');
  });

  it('is pure — repeated calls with the same input return the same output', () => {
    expect(markdownDownloadFilename('icp-v2.md')).toBe(markdownDownloadFilename('icp-v2.md'));
  });
});

// ---------------------------------------------------------------------------
// downloadMarkdownFile
// ---------------------------------------------------------------------------

describe('downloadMarkdownFile', () => {
  const originalCreateObjectURL = URL.createObjectURL;
  const originalRevokeObjectURL = URL.revokeObjectURL;

  beforeEach(() => {
    URL.createObjectURL = vi.fn(() => 'blob:mock-url');
    URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    URL.createObjectURL = originalCreateObjectURL;
    URL.revokeObjectURL = originalRevokeObjectURL;
  });

  function fakeDoc() {
    const anchor = { href: '', download: '', click: vi.fn() } as unknown as HTMLAnchorElement;
    const doc = { createElement: vi.fn(() => anchor) } as unknown as Document;
    return { doc, anchor };
  }

  it('creates a Blob with type text/markdown from the given text', () => {
    const { doc } = fakeDoc();
    downloadMarkdownFile('# hello', 'notes', doc);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
    const blob = (URL.createObjectURL as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0] as Blob;
    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('text/markdown');
  });

  it('sets the anchor href from the object URL and the normalized download filename', () => {
    const { doc, anchor } = fakeDoc();
    downloadMarkdownFile('# hello', 'My Notes.MD', doc);
    expect(anchor.href).toBe('blob:mock-url');
    expect(anchor.download).toBe('My Notes.md');
  });

  it('clicks the anchor exactly once', () => {
    const { doc, anchor } = fakeDoc();
    downloadMarkdownFile('# hello', 'notes', doc);
    expect(anchor.click).toHaveBeenCalledTimes(1);
  });

  it('revokes the object URL after clicking', () => {
    const { doc } = fakeDoc();
    downloadMarkdownFile('# hello', 'notes', doc);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock-url');
  });

  it('creates the anchor via the injected document', () => {
    const { doc } = fakeDoc();
    downloadMarkdownFile('# hello', 'notes', doc);
    expect(doc.createElement).toHaveBeenCalledWith('a');
  });

  it('defaults to the global document when doc is omitted', () => {
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    downloadMarkdownFile('# hi', 'default-doc');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    clickSpy.mockRestore();
  });
});
