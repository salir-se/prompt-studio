// @module-tag dom
/**
 * BDD coverage for read-markdown-file utilities:
 *   - isAcceptedMarkdownFile: extension-primary acceptance check
 *   - suggestedLabelFromFilename: basename + extension strip + 60-char cap
 *   - readMarkdownFile: validate → size-guard → read → binary-check → return
 */

import { describe, expect, it } from 'vitest';
import {
  ACCEPTED_MARKDOWN_EXTENSIONS,
  ACCEPTED_MARKDOWN_MIME_TYPES,
  isAcceptedMarkdownFile,
  MarkdownUploadError,
  MAX_PROMPT_UPLOAD_BYTES,
  readMarkdownFile,
  suggestedLabelFromFilename,
} from './read-markdown-file';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

describe('exported constants', () => {
  it('MAX_PROMPT_UPLOAD_BYTES is 512 KiB', () => {
    expect(MAX_PROMPT_UPLOAD_BYTES).toBe(512 * 1024);
  });

  it('ACCEPTED_MARKDOWN_EXTENSIONS contains .md, .markdown, .txt', () => {
    expect(ACCEPTED_MARKDOWN_EXTENSIONS).toContain('.md');
    expect(ACCEPTED_MARKDOWN_EXTENSIONS).toContain('.markdown');
    expect(ACCEPTED_MARKDOWN_EXTENSIONS).toContain('.txt');
  });

  it('ACCEPTED_MARKDOWN_MIME_TYPES contains text/markdown and text/x-markdown', () => {
    expect(ACCEPTED_MARKDOWN_MIME_TYPES).toContain('text/markdown');
    expect(ACCEPTED_MARKDOWN_MIME_TYPES).toContain('text/x-markdown');
  });
});

// ---------------------------------------------------------------------------
// MarkdownUploadError
// ---------------------------------------------------------------------------

describe('MarkdownUploadError', () => {
  it('is an instance of Error', () => {
    const err = new MarkdownUploadError('TOO_LARGE', 'too big');
    expect(err).toBeInstanceOf(Error);
  });

  it('stores the code', () => {
    const err = new MarkdownUploadError('UNSUPPORTED_TYPE', 'bad type');
    expect(err.code).toBe('UNSUPPORTED_TYPE');
  });

  it('stores the message', () => {
    const err = new MarkdownUploadError('BINARY', 'binary content');
    expect(err.message).toBe('binary content');
  });

  it('stores the READ_FAILED code', () => {
    const err = new MarkdownUploadError('READ_FAILED', 'read error');
    expect(err.code).toBe('READ_FAILED');
  });
});

// ---------------------------------------------------------------------------
// isAcceptedMarkdownFile
// ---------------------------------------------------------------------------

describe('isAcceptedMarkdownFile', () => {
  it('accepts a .md file', () => {
    expect(isAcceptedMarkdownFile(new File([''], 'notes.md'))).toBe(true);
  });

  it('accepts a .markdown file', () => {
    expect(isAcceptedMarkdownFile(new File([''], 'notes.markdown'))).toBe(true);
  });

  it('accepts a .txt file', () => {
    expect(isAcceptedMarkdownFile(new File([''], 'notes.txt'))).toBe(true);
  });

  it('accepts uppercase .MD extension', () => {
    expect(isAcceptedMarkdownFile(new File([''], 'NOTES.MD'))).toBe(true);
  });

  it('accepts uppercase .MARKDOWN extension', () => {
    expect(isAcceptedMarkdownFile(new File([''], 'README.MARKDOWN'))).toBe(true);
  });

  it('accepts uppercase .TXT extension', () => {
    expect(isAcceptedMarkdownFile(new File([''], 'README.TXT'))).toBe(true);
  });

  it('accepts by MIME type text/markdown (no extension)', () => {
    const file = new File([''], 'prompt', { type: 'text/markdown' });
    expect(isAcceptedMarkdownFile(file)).toBe(true);
  });

  it('accepts by MIME type text/x-markdown', () => {
    const file = new File([''], 'prompt', { type: 'text/x-markdown' });
    expect(isAcceptedMarkdownFile(file)).toBe(true);
  });

  it('rejects a .pdf file with empty type', () => {
    expect(isAcceptedMarkdownFile(new File([''], 'doc.pdf'))).toBe(false);
  });

  it('rejects a .png file with empty type', () => {
    expect(isAcceptedMarkdownFile(new File([''], 'image.png'))).toBe(false);
  });

  it('rejects a file with no extension and no MIME type', () => {
    expect(isAcceptedMarkdownFile(new File([''], 'README'))).toBe(false);
  });

  it('rejects application/pdf MIME even with no extension', () => {
    const file = new File([''], 'doc', { type: 'application/pdf' });
    expect(isAcceptedMarkdownFile(file)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// suggestedLabelFromFilename
// ---------------------------------------------------------------------------

describe('suggestedLabelFromFilename', () => {
  it('strips .md extension', () => {
    expect(suggestedLabelFromFilename('icp-v2.md')).toBe('icp-v2');
  });

  it('strips .markdown extension case-insensitively', () => {
    expect(suggestedLabelFromFilename('/tmp/Notes.MARKDOWN')).toBe('Notes');
  });

  it('strips .txt extension', () => {
    expect(suggestedLabelFromFilename('plain.txt')).toBe('plain');
  });

  it('preserves a name with no extension', () => {
    expect(suggestedLabelFromFilename('noext')).toBe('noext');
  });

  it('returns empty string for empty input', () => {
    expect(suggestedLabelFromFilename('')).toBe('');
  });

  it('strips unix-style path', () => {
    expect(suggestedLabelFromFilename('/tmp/Notes.MARKDOWN')).toBe('Notes');
  });

  it('strips windows-style path', () => {
    expect(suggestedLabelFromFilename('C:\\Users\\me\\notes.md')).toBe('notes');
  });

  it('caps result at 60 characters', () => {
    const long = `${'a'.repeat(80)}.md`;
    const result = suggestedLabelFromFilename(long);
    expect(result.length).toBe(60);
    expect(result).toBe('a'.repeat(60));
  });

  it('trims surrounding whitespace before capping', () => {
    expect(suggestedLabelFromFilename('  spaced.md  ')).toBe('spaced');
  });
});

// ---------------------------------------------------------------------------
// readMarkdownFile
// ---------------------------------------------------------------------------

describe('readMarkdownFile', () => {
  it('reads text of a valid .md file and returns { text, name }', async () => {
    const file = new File(['# Hello\n\nWorld'], 'readme.md');
    const result = await readMarkdownFile(file);
    expect(result).toEqual({ text: '# Hello\n\nWorld', name: 'readme.md' });
  });

  it('accepts a .markdown file', async () => {
    const file = new File(['content'], 'doc.markdown');
    const result = await readMarkdownFile(file);
    expect(result.name).toBe('doc.markdown');
    expect(result.text).toBe('content');
  });

  it('accepts a .txt file', async () => {
    const file = new File(['plain text'], 'notes.txt');
    const result = await readMarkdownFile(file);
    expect(result.text).toBe('plain text');
  });

  it('returns empty text for an empty file', async () => {
    const file = new File([''], 'empty.md');
    const result = await readMarkdownFile(file);
    expect(result.text).toBe('');
    expect(result.name).toBe('empty.md');
  });

  it('throws UNSUPPORTED_TYPE for a .pdf file', async () => {
    const file = new File(['%PDF-1.4'], 'doc.pdf');
    await expect(readMarkdownFile(file)).rejects.toMatchObject({
      code: 'UNSUPPORTED_TYPE',
    });
  });

  it('throws UNSUPPORTED_TYPE with the expected message', async () => {
    const file = new File(['data'], 'image.png');
    await expect(readMarkdownFile(file)).rejects.toMatchObject({
      code: 'UNSUPPORTED_TYPE',
      message: 'Please upload a markdown file (.md, .markdown, or .txt).',
    });
  });

  it('throws UNSUPPORTED_TYPE error that is instance of MarkdownUploadError', async () => {
    const file = new File(['data'], 'image.png');
    try {
      await readMarkdownFile(file);
      expect.fail('should have thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(MarkdownUploadError);
    }
  });

  it('throws TOO_LARGE when file.size exceeds MAX_PROMPT_UPLOAD_BYTES', async () => {
    const file = new File(['x'], 'big.md');
    Object.defineProperty(file, 'size', { value: MAX_PROMPT_UPLOAD_BYTES + 1 });
    await expect(readMarkdownFile(file)).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });

  it('throws TOO_LARGE with the expected message', async () => {
    const file = new File(['x'], 'big.md');
    Object.defineProperty(file, 'size', { value: MAX_PROMPT_UPLOAD_BYTES + 1 });
    await expect(readMarkdownFile(file)).rejects.toMatchObject({
      code: 'TOO_LARGE',
      message: 'File is too large (max 512 KB).',
    });
  });

  it('accepts a file exactly at MAX_PROMPT_UPLOAD_BYTES (boundary)', async () => {
    const file = new File(['x'], 'edge.md');
    Object.defineProperty(file, 'size', { value: MAX_PROMPT_UPLOAD_BYTES });
    // Should not throw — just read. We only care it resolves.
    await expect(readMarkdownFile(file)).resolves.toBeDefined();
  });

  it('throws BINARY when text contains a NUL character', async () => {
    const file = new File(['a b'], 'x.md');
    await expect(readMarkdownFile(file)).rejects.toMatchObject({ code: 'BINARY' });
  });

  it('throws BINARY with the expected message', async () => {
    const file = new File(['a b'], 'binary.md');
    await expect(readMarkdownFile(file)).rejects.toMatchObject({
      code: 'BINARY',
      message: 'This file looks binary, not markdown text.',
    });
  });

  it('throws READ_FAILED when file.text() rejects', async () => {
    const fakeFile = {
      name: 'x.md',
      type: 'text/markdown',
      size: 1,
      text: () => Promise.reject(new Error('boom')),
    } as unknown as File;
    await expect(readMarkdownFile(fakeFile)).rejects.toMatchObject({ code: 'READ_FAILED' });
  });

  it('throws READ_FAILED with the expected message', async () => {
    const fakeFile = {
      name: 'broken.md',
      type: 'text/markdown',
      size: 1,
      text: () => Promise.reject(new Error('disk error')),
    } as unknown as File;
    await expect(readMarkdownFile(fakeFile)).rejects.toMatchObject({
      code: 'READ_FAILED',
      message: 'Could not read the file. Please try again.',
    });
  });

  it('falls back to FileReader when file.text is not a function', async () => {
    // Simulate an environment where File.text is unavailable by providing an
    // object without a text method.
    const content = '# Fallback path\n';
    const fileWithNoText = Object.assign(new File([content], 'fallback.md'), {
      text: undefined,
    });

    // happy-dom should support FileReader
    const result = await readMarkdownFile(fileWithNoText as unknown as File);
    expect(result.text).toBe(content);
    expect(result.name).toBe('fallback.md');
  });

  it('throws READ_FAILED when FileReader fires an error', async () => {
    // Build a fake File-like object that has no text() and whose underlying
    // blob causes FileReader to emit an error event.  We simulate this by
    // overriding the global FileReader with a fake that immediately fires onerror.
    const OriginalFileReader = globalThis.FileReader;
    try {
      // @ts-expect-error — intentionally replacing with a fake
      globalThis.FileReader = class FakeErrorReader {
        onload: (() => void) | null = null;
        onerror: ((ev: ProgressEvent) => void) | null = null;
        error: DOMException = new DOMException('Read failed', 'NotReadableError');
        result: string | null = null;
        readAsText(_blob: Blob): void {
          // Defer to let the promise listener attach
          queueMicrotask(() => {
            if (this.onerror) this.onerror(new ProgressEvent('error'));
          });
        }
      };

      const fakeFile = Object.assign(new File(['data'], 'err.md'), { text: undefined });
      await expect(readMarkdownFile(fakeFile as unknown as File)).rejects.toMatchObject({
        code: 'READ_FAILED',
      });
    } finally {
      globalThis.FileReader = OriginalFileReader;
    }
  });
});
