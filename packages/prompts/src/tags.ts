/**
 * Identity tagged-template helper for defining agent prompts.
 *
 * `md` returns the template string **unchanged** — it exists purely so editors
 * inject Markdown highlighting + formatting into the embedded literal (the
 * prompts are Markdown-structured: headings, lists, bold, fenced blocks).
 * JetBrains keys off the tag name; VS Code via the *es6-string-html* /
 * *Comment tagged templates* extensions.
 *
 * Why a tag and not `import './x.md?raw'`: this package ships raw `src` with no
 * build step and is consumed by several bundlers (wrangler/esbuild, Vite/vitest,
 * Bun) that share no portable raw-text import syntax. An identity tag needs zero
 * bundler/runtime support and renders byte-identically. Mirrors the `html`/`text`
 * tags in `@prompt-studio/email-templates`. Prompts interpolate `{{ placeholder }}` at
 * runtime — those render as plain text inside the Markdown injection.
 */

/** Markdown prompt body. Identity at runtime. */
export const md = (strings: TemplateStringsArray, ...values: unknown[]): string => {
  let out = strings[0] ?? '';
  for (let i = 0; i < values.length; i++) out += String(values[i]) + (strings[i + 1] ?? '');
  return out;
};
