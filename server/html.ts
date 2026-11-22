/**
 * Injects the per-boot `studio-token` `<meta>` tag into an `index.html` document.
 *
 * SECURITY REQUIREMENT: this must run against the static `index.html` source at REQUEST time,
 * never at build/image time. The prompt-studio Docker image is published once and pulled by
 * everyone; a token baked into the artifact would be identical for every container that ever
 * runs that image, forever, defeating the entire point of a per-boot secret (see
 * `apps/prompt-studio/src/bridge/fs-bridge.ts`'s `createStudioFsBridgePlugin`, whose Vite-dev
 * equivalent does this via `transformIndexHtml` on every request for the same reason).
 */

/** Matches the opening `<head>` tag, with or without attributes, case-insensitively. */
const HEAD_OPEN_TAG = /<head(\s[^>]*)?>/i;

/**
 * Builds the `<meta name="studio-token" …>` tag for `token`. `token` is always a `randomUUID()`
 * value (hex digits and hyphens only — see `server/main.ts`), so it can never contain a `"` or
 * close the attribute early; no HTML-attribute escaping is needed for that specific input shape.
 */
function studioTokenMetaTag(token: string): string {
  return `<meta name="studio-token" content="${token}">`;
}

/**
 * Inserts the studio-token meta tag as the first child of `<head>`. Falls back to prepending the
 * tag to the whole document if no `<head>` tag is found (a malformed static build) — the client
 * (`FinalPromptPanel.tsx`) looks the tag up with a plain `document.querySelector`, which finds it
 * anywhere in the document, so a missing `<head>` degrades the page rather than silently breaking
 * the bridge contract.
 */
export function injectStudioToken(html: string, token: string): string {
  const metaTag = studioTokenMetaTag(token);
  if (HEAD_OPEN_TAG.test(html)) {
    return html.replace(HEAD_OPEN_TAG, (match) => `${match}${metaTag}`);
  }
  return `${metaTag}${html}`;
}
