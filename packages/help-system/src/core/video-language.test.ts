// @module-tag dom
import { describe, expect, it, vi } from 'vitest';
import { browserLocale, normalizeVideoLanguage } from './video-language';

describe('video language', () => {
  it('uses the first browser language, then language, then English for SSR/empty settings', () => {
    vi.stubGlobal('navigator', { languages: ['sv-SE', 'en-US'], language: 'en-US' });
    expect(browserLocale()).toBe('sv-SE');
    vi.stubGlobal('navigator', { languages: [], language: 'de-DE' });
    expect(browserLocale()).toBe('de-DE');
    vi.stubGlobal('navigator', undefined);
    expect(browserLocale()).toBe('en');
    vi.unstubAllGlobals();
  });

  it.each(['sv-SE', 'de-DE', 'en', 'pt-BR', 'zh-Hant'])('accepts %s', (locale) => {
    expect(normalizeVideoLanguage(locale)).toBe(locale);
  });

  it.each(['sv&origin=evil', 'en_US', '', 'en\n', '<script>', 'a', undefined])(
    'drops malformed language %s',
    (locale) => {
      expect(normalizeVideoLanguage(locale)).toBeUndefined();
    },
  );
});
