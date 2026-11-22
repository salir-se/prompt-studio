/** Restrict external caption preferences to language tags, never arbitrary player options. */
export function normalizeVideoLanguage(value?: string): string | undefined {
  return value && /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{1,8})*$/.test(value) ? value : undefined;
}

/** The Help host may override this; otherwise respect the browser's preference order. */
export function browserLocale(): string {
  if (typeof navigator === 'undefined') return 'en';
  return normalizeVideoLanguage(navigator.languages?.[0]) ?? normalizeVideoLanguage(navigator.language) ?? 'en';
}
