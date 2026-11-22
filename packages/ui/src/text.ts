export type TranslationValue = string | number | boolean | null | undefined;

export type TranslationValues = Readonly<Record<string, TranslationValue>>;

export type TranslationOptions = TranslationValues & {
  readonly defaultValue?: string;
  readonly defaultValue_one?: string;
  readonly defaultValue_other?: string;
  readonly count?: number;
};

export interface Message {
  readonly key: string;
  readonly defaultValue: string;
  readonly defaultValue_one?: string;
  readonly defaultValue_other?: string;
}

export function t(key: string, options: TranslationOptions = {}): string {
  const pluralDefault =
    options.count === undefined
      ? undefined
      : options.count === 1
        ? options.defaultValue_one
        : options.defaultValue_other;
  const template = pluralDefault ?? options.defaultValue ?? key;

  return template.replace(/\{\{([^{}]+)\}\}/g, (placeholder, name: string) => {
    const value = options[name];
    return Object.hasOwn(options, name) && value != null ? String(value) : placeholder;
  });
}

export function m(message: Message, values: TranslationValues = {}): string {
  // Last-resort guard: `m(LABELS[dataValue])` call sites index copy maps by
  // runtime data, and a missed lookup used to throw ("Cannot read properties
  // of undefined (reading 'key')") — one missing label took down the whole
  // render tree via the ErrorBoundary. A missing message degrades to an empty
  // string and complains loudly instead; the real fix is always the caller's
  // lookup, so keep the parameter type strict.
  if (!message) {
    console.error('[text] m() called without a message — missing copy entry for a data-indexed label');
    return '';
  }
  return t(message.key, {
    ...values,
    defaultValue: message.defaultValue,
    defaultValue_one: message.defaultValue_one,
    defaultValue_other: message.defaultValue_other,
  });
}
