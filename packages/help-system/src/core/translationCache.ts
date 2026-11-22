// Runtime translation cache (ADR-089 §8a G10). Pure + framework-agnostic.
//
// Content is English-authored; the assistant translates FAQ answers on demand.
// Translations are bounded in cost/latency by caching keyed on the content
// VERSION (from `ContentMeta.version`, G9), so an English edit (bumped version)
// naturally invalidates stale translations — the new version produces a new key
// and the old entry becomes unreachable. The actual translate call is injected
// (the host wires it to the assistant), keeping this layer dependency-free.

/** The parts that uniquely identify a translation. */
export interface TranslationKeyParts {
  /** Stable content id (e.g. a FAQ id). */
  contentId: string;
  /** Content version from `ContentMeta.version`; a bump invalidates old translations. */
  version?: number;
  /** Source locale of the authored text (default `en`). */
  sourceLocale?: string;
  /** Target locale to translate into. */
  targetLocale: string;
}

/** Deterministic cache key. Version defaults to 0 and source to `en`. */
export function translationCacheKey(parts: TranslationKeyParts): string {
  return [parts.contentId, parts.version ?? 0, parts.sourceLocale ?? 'en', parts.targetLocale].join('::');
}

/** Minimal persistence port — host may back it with localStorage/IndexedDB. */
export interface TranslationStore {
  get(key: string): string | undefined;
  set(key: string, value: string): void;
}

/** In-memory store (default). */
export function createMemoryTranslationStore(): TranslationStore {
  const map = new Map<string, string>();
  return { get: (k) => map.get(k), set: (k, v) => void map.set(k, v) };
}

/** Performs the actual translation (host wires this to the assistant). */
export type Translator = (
  parts: Required<Pick<TranslationKeyParts, 'targetLocale'>> & TranslationKeyParts,
) => Promise<string>;

export interface TranslationCache {
  /** Cached translation, if present. */
  get(parts: TranslationKeyParts): string | undefined;
  has(parts: TranslationKeyParts): boolean;
  /**
   * Return the cached translation, or translate-then-cache on a miss. Concurrent
   * calls for the same key share a single in-flight translation (no double work).
   */
  translate(parts: TranslationKeyParts, translator: Translator): Promise<string>;
}

/** Build a translation cache over a store (in-memory by default). */
export function createTranslationCache(store: TranslationStore = createMemoryTranslationStore()): TranslationCache {
  const inFlight = new Map<string, Promise<string>>();

  const get = (parts: TranslationKeyParts) => store.get(translationCacheKey(parts));

  return {
    get,
    has: (parts) => get(parts) !== undefined,
    async translate(parts, translator) {
      const key = translationCacheKey(parts);
      const cached = store.get(key);
      if (cached !== undefined) return cached;

      const pending = inFlight.get(key);
      if (pending) return pending;

      const promise = translator(parts)
        .then((text) => {
          store.set(key, text);
          return text;
        })
        .finally(() => inFlight.delete(key));
      inFlight.set(key, promise);
      return promise;
    },
  };
}
