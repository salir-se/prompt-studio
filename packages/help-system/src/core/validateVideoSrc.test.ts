// @module-tag dom
import { describe, expect, it } from 'vitest';
import { validateVideoSrc } from './validateVideoSrc';

const id = 'dQw4w9WgXcQ'; // 11 chars

describe('validateVideoSrc — accepts trusted YouTube sources', () => {
  it('accepts a bare 11-char video id and returns a nocookie embed url', () => {
    const r = validateVideoSrc(id);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.video.videoId).toBe(id);
      expect(r.video.embedUrl).toBe(`https://www.youtube-nocookie.com/embed/${id}`);
    }
  });

  it.each([
    `https://www.youtube.com/watch?v=${id}`,
    `https://youtu.be/${id}`,
    `https://www.youtube.com/embed/${id}`,
    `https://www.youtube-nocookie.com/embed/${id}`,
    `https://m.youtube.com/watch?v=${id}`,
    `https://www.youtube.com/shorts/${id}`,
  ])('accepts %s', (src) => {
    const r = validateVideoSrc(src);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.video.videoId).toBe(id);
  });

  it('extracts a start offset and reflects it in the embed url', () => {
    const r = validateVideoSrc(`https://youtu.be/${id}?t=30`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.video.startSeconds).toBe(30);
      expect(r.video.embedUrl).toContain('start=30');
    }
  });
});

describe('validateVideoSrc — rejects everything else', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'whitespace'],
    ['not-a-url', 'garbage string'],
    ['https://vimeo.com/123456', 'non-YouTube host'],
    [`https://evil.com/watch?v=${id}`, 'wrong host with a valid id'],
    [`https://youtube.com.evil.com/embed/${id}`, 'look-alike host'],
    ['javascript:alert(1)', 'javascript protocol'],
    ['data:text/html,<script>', 'data protocol'],
    ['https://www.youtube.com/watch?v=short', 'malformed id'],
  ])('rejects %s (%s)', (src) => {
    expect(validateVideoSrc(src).ok).toBe(false);
  });

  it('never returns an embed url for a rejected source', () => {
    const r = validateVideoSrc(`https://evil.com/embed/${id}`);
    expect(r.ok).toBe(false);
    expect('video' in r).toBe(false);
  });
});

describe('validated video localization', () => {
  it('retains only valid caption preferences and drops unrelated query parameters', () => {
    const result = validateVideoSrc(
      `https://www.youtube-nocookie.com/embed/${id}?hl=sv&cc_lang_pref=sv-SE&cc_load_policy=1&origin=https://evil.com&enablejsapi=1&autoplay=0`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const url = new URL(result.video.embedUrl);
    expect(url.searchParams.get('hl')).toBe('sv');
    expect(url.searchParams.get('cc_lang_pref')).toBe('sv-SE');
    expect(url.searchParams.get('cc_load_policy')).toBe('1');
    expect(url.searchParams.has('origin')).toBe(false);
    expect(url.searchParams.has('enablejsapi')).toBe(false);
    expect(url.searchParams.has('autoplay')).toBe(false);
  });

  it('drops malformed language and caption-policy values', () => {
    const result = validateVideoSrc(
      `https://youtu.be/${id}?hl=en%26origin%3Devil&cc_lang_pref=<script>&cc_load_policy=2`,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.video.embedUrl).toBe(`https://www.youtube-nocookie.com/embed/${id}`);
  });
});
