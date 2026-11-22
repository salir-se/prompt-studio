// Cross-origin isolation fallback for the PiP tutorial player (ADR-275 D11).
//
// `app.salir.*` sends `Cross-Origin-Embedder-Policy: credentialless` so the
// document can become cross-origin isolated (SharedArrayBuffer, needed by the
// Turso Sync local replica). Under that policy a cross-origin <iframe> loads
// only if EITHER the iframe itself carries the `credentialless` attribute OR
// the framed document sends its own `Cross-Origin-Embedder-Policy` header —
// YouTube's embed response does neither by default, so the `credentialless`
// attribute is the only unblock actually available here, which is why
// PipPlayer renders its own <iframe> instead of going through a library that
// owns the element. A browser that enforces isolation but cannot render a
// `credentialless` iframe would silently block the embed, so that one
// combination falls back to a link-out card instead of a blank box. Firefox
// hits it today: it has supported COEP `credentialless` since Firefox 119
// (so `crossOriginIsolated` is true under this header) but has not shipped
// the iframe `credentialless` attribute — Chromium embeds inline, and Safari
// never enforces COEP and stays non-isolated, so it also embeds inline.

export interface PipEmbedModeInput {
  /** Whether the current document is cross-origin isolated (`window.crossOriginIsolated`). */
  crossOriginIsolated: boolean;
  /** Whether this browser supports the iframe `credentialless` attribute. */
  iframeCredentiallessSupported: boolean;
}

export type PipEmbedMode = 'embed' | 'link-out';

/**
 * Decide whether the PiP player should embed the YouTube iframe or fall back
 * to a link-out card. `link-out` only when the document IS isolated AND the
 * browser CANNOT render a `credentialless` iframe (isolation would otherwise
 * block the embed outright) — Firefox hits this today: COEP `credentialless`
 * has shipped since Firefox 119 (so `crossOriginIsolated` is true) but the
 * iframe `credentialless` attribute has not, so Firefox users of the Sales
 * app get the "Open on YouTube" link-out card instead of the inline tutorial.
 * A future Firefox release that ships the attribute regains the inline embed
 * automatically, with no code change here, because both signals are
 * feature-detected. Every other combination — including a non-isolated
 * browser such as Safari, which never sends/enforces COEP and keeps
 * embedding as today — resolves to `embed`.
 */
export function pipEmbedMode({ crossOriginIsolated, iframeCredentiallessSupported }: PipEmbedModeInput): PipEmbedMode {
  return crossOriginIsolated && !iframeCredentiallessSupported ? 'link-out' : 'embed';
}

/**
 * Read the two capability signals from the current environment and resolve
 * the PiP embed mode. Guarded for non-browser environments (SSR, Node test
 * runners without `HTMLIFrameElement`) where both signals default to "safe
 * to embed" — the same posture a non-isolated browser gets.
 */
export function detectPipEmbedMode(): PipEmbedMode {
  const crossOriginIsolated = typeof globalThis.crossOriginIsolated === 'boolean' && globalThis.crossOriginIsolated;
  const iframeCredentiallessSupported =
    typeof HTMLIFrameElement !== 'undefined' && 'credentialless' in HTMLIFrameElement.prototype;
  return pipEmbedMode({ crossOriginIsolated, iframeCredentiallessSupported });
}
