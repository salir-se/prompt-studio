// @vitest-environment node
// @module-tag pure
// Pure server-side HTML string manipulation — no DOM dependency, so this runs under plain Node
// rather than the app's default happy-dom environment (see main.test.ts for why that matters here).
import { describe, expect, it } from 'vitest';
import { injectStudioToken } from './html';

describe('injectStudioToken', () => {
  it('inserts the meta tag as the first child of <head>', () => {
    const html = '<!doctype html><html><head><title>Studio</title></head><body></body></html>';
    const result = injectStudioToken(html, 'abc-123');
    expect(result).toBe(
      '<!doctype html><html><head><meta name="studio-token" content="abc-123"><title>Studio</title></head><body></body></html>',
    );
  });

  it('handles a <head> tag with attributes', () => {
    const html = '<html><head lang="en"><title>t</title></head><body></body></html>';
    const result = injectStudioToken(html, 'tok-1');
    expect(result).toBe(
      '<html><head lang="en"><meta name="studio-token" content="tok-1"><title>t</title></head><body></body></html>',
    );
  });

  it('is case-insensitive on the <HEAD> tag', () => {
    const html = '<HTML><HEAD><title>t</title></HEAD></HTML>';
    const result = injectStudioToken(html, 'tok-2');
    expect(result).toBe('<HTML><HEAD><meta name="studio-token" content="tok-2"><title>t</title></HEAD></HTML>');
  });

  it('falls back to prepending the tag when there is no <head> at all', () => {
    const html = '<html><body>no head here</body></html>';
    const result = injectStudioToken(html, 'tok-3');
    expect(result).toBe('<meta name="studio-token" content="tok-3"><html><body>no head here</body></html>');
  });

  it('produces a different document for a different token on the same source html', () => {
    const html = '<html><head><title>t</title></head><body></body></html>';
    const first = injectStudioToken(html, 'boot-a');
    const second = injectStudioToken(html, 'boot-b');
    expect(first).toBe(
      '<html><head><meta name="studio-token" content="boot-a"><title>t</title></head><body></body></html>',
    );
    expect(second).toBe(
      '<html><head><meta name="studio-token" content="boot-b"><title>t</title></head><body></body></html>',
    );
  });
});
