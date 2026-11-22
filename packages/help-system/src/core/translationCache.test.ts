// @module-tag dom
import { describe, expect, it, vi } from 'vitest';
import { createTranslationCache, translationCacheKey } from './translationCache';

describe('translationCacheKey', () => {
  it('includes contentId, version, source + target locale', () => {
    expect(translationCacheKey({ contentId: 'scout.what', version: 3, sourceLocale: 'en', targetLocale: 'es' })).toBe(
      'scout.what::3::en::es',
    );
  });

  it('defaults version to 0 and source to en', () => {
    expect(translationCacheKey({ contentId: 'x', targetLocale: 'fr' })).toBe('x::0::en::fr');
  });

  it('produces a different key when the version bumps (invalidation)', () => {
    const base = { contentId: 'x', targetLocale: 'fr' };
    expect(translationCacheKey({ ...base, version: 1 })).not.toBe(translationCacheKey({ ...base, version: 2 }));
  });
});

describe('createTranslationCache', () => {
  it('translates on a miss and caches on the repeat', async () => {
    const cache = createTranslationCache();
    const translator = vi.fn().mockResolvedValue('hola');
    const parts = { contentId: 'greeting', version: 1, targetLocale: 'es' };

    expect(await cache.translate(parts, translator)).toBe('hola');
    expect(await cache.translate(parts, translator)).toBe('hola');
    expect(translator).toHaveBeenCalledTimes(1);
    expect(cache.has(parts)).toBe(true);
  });

  it('re-translates after a version bump (stale translation invalidated)', async () => {
    const cache = createTranslationCache();
    const translator = vi.fn().mockResolvedValueOnce('v1').mockResolvedValueOnce('v2');

    expect(await cache.translate({ contentId: 'x', version: 1, targetLocale: 'de' }, translator)).toBe('v1');
    expect(await cache.translate({ contentId: 'x', version: 2, targetLocale: 'de' }, translator)).toBe('v2');
    expect(translator).toHaveBeenCalledTimes(2);
  });

  it('keeps target locales separate', async () => {
    const cache = createTranslationCache();
    const translator = vi.fn(async (p) => `t-${p.targetLocale}`);
    expect(await cache.translate({ contentId: 'x', targetLocale: 'es' }, translator)).toBe('t-es');
    expect(await cache.translate({ contentId: 'x', targetLocale: 'fr' }, translator)).toBe('t-fr');
    expect(translator).toHaveBeenCalledTimes(2);
  });

  it('dedupes concurrent calls for the same key into one translation', async () => {
    const cache = createTranslationCache();
    let resolve: (v: string) => void = () => {};
    const translator = vi.fn(() => new Promise<string>((r) => (resolve = r)));
    const parts = { contentId: 'x', targetLocale: 'es' };

    const a = cache.translate(parts, translator);
    const b = cache.translate(parts, translator);
    resolve('once');
    expect(await a).toBe('once');
    expect(await b).toBe('once');
    expect(translator).toHaveBeenCalledTimes(1);
  });
});
