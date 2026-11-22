/**
 * Turning an arbitrary upstream failure into a line a human can read.
 *
 * Error strings reach our UI from places that were never asked to be readable:
 * a CDN's WAF block page, an origin's 502, a captive portal, an SDK that
 * splices a response body verbatim into the message it throws. Every one of
 * those arrives as a `string` that ends up in a toast, a destructive alert, or
 * a log line — and an HTML document rendered as an error message is a wall of
 * markup, not a diagnostic.
 *
 * This module is the single place that reduces such a string to one bounded,
 * markup-free sentence. It lives next to `masking`/`redaction` because it
 * solves the same class of problem: what an untrusted diagnostic is allowed to
 * look like once it leaves the machine and reaches a person.
 */

/**
 * Upper bound on how much of an upstream HTML body we parse. Error pages are a
 * few KB; anything past this is padding and only costs us regex time.
 */
const MAX_HTML_PARSE_CHARS = 64_000;

/** Upper bound on the human-readable text lifted out of an HTML error page. */
export const MAX_HTML_ERROR_TEXT_CHARS = 240;

/**
 * Upper bound on a whole display line. Sized so the longest result still fits a
 * few wrapped lines inside an alert on a 375 px viewport instead of pushing the
 * alert's own actions off the fold.
 */
export const MAX_DISPLAY_ERROR_CHARS = 300;

/** Shown when a page is markup all the way down with no readable sentence in it. */
const EMPTY_HTML_PLACEHOLDER = '(HTML error page)';

/**
 * Elements that only ever appear in real markup. Matching against a closed list
 * — rather than "any `<` followed by a letter" — keeps ordinary error prose
 * intact: `Unsupported key <apiKey>` and `Expected value < 3` are messages a
 * user needs verbatim, and a validation error that loses the field it names is
 * worse than one that keeps a stray bracket.
 */
const HTML_TAG_NAMES =
  'html|head|body|title|meta|link|script|style|div|span|p|h[1-6]|a|br|hr|center|pre|font|b|i|u|strong|em|table|thead|tbody|tr|td|th|ul|ol|li|dl|dt|dd|form|input|button|img|section|article|header|footer|nav|main|iframe|svg|blockquote|address';

/** Doctype, comment, or one of {@link HTML_TAG_NAMES} — opening or closing. */
const MARKUP_START = new RegExp(`<(?:!doctype\\b|!--|/?(?:${HTML_TAG_NAMES})(?=[\\s/>]))`, 'i');

/**
 * True when `contentType` declares an HTML body.
 *
 * MCP is JSON-RPC over `application/json` (plus `text/event-stream` for the
 * optional SSE channel), so HTML is *never* a valid MCP response — it is an
 * error page injected by some hop in between: an origin 5xx, a captive portal,
 * or the MCP vendor's own WAF. Matched case-insensitively because the media
 * type is case-insensitive per RFC 9110 and real edges do send `TEXT/HTML`.
 */
export function isHtmlMediaType(contentType: string | null | undefined): boolean {
  return (contentType ?? '').toLowerCase().includes('text/html');
}

/** True when `text` contains something that is unambiguously markup. */
export function containsMarkup(text: string): boolean {
  return MARKUP_START.test(text);
}

/** Strip markup, comments, scripts, styles and entities down to plain text. */
export function stripMarkup(html: string): string {
  return (
    html
      // Comments first — this also removes the IE conditionals that wrap the
      // opening <html> tag on a Cloudflare error page.
      .replace(/[<]!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<[^>]*>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&bull;/gi, '·')
      .replace(/&quot;/gi, '"')
      .replace(/&#0*39;/g, "'")
      .replace(/&amp;/gi, '&')
      // Deliberately NOT decoding &lt;/&gt;: this string lands in a toast and a
      // UI banner, and re-introducing angle brackets is exactly what we set out
      // to remove. Drop any stragglers instead.
      .replace(/[<>]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Collapse every run of whitespace — including newlines — into one space. */
function collapseWhitespace(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/** Truncate to `maxLength`, spending the last character on an ellipsis. */
function bound(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength - 1).trimEnd()}…`;
}

/**
 * The Cloudflare Ray ID identifying this specific block, when the page carries
 * one. It is the only token that lets the upstream vendor (or Cloudflare
 * support) find the request in their logs, so it is worth surfacing to the user
 * even though the rest of the page is noise. Read from the raw HTML because the
 * value sits inside a `<strong>` nested in the footer span.
 */
export function extractCloudflareRayId(html: string): string | undefined {
  return /ray\s*id:?\s*(?:<[^>]*>\s*)*([0-9a-f]{8,32})\b/i.exec(html.slice(0, MAX_HTML_PARSE_CHARS))?.[1];
}

/**
 * Lift the human-readable error out of an HTML error page.
 *
 * Prefers the page's headings (`<h1>`/`<h2>`) — on every error page worth
 * reporting, that is the sentence that actually names the failure ("Sorry, you
 * have been blocked", "502 Bad Gateway"). Falls back to `<title>`, then to the
 * whole stripped body. The surrounding boilerplate prose ("This website is
 * using a security service…") is intentionally dropped: it explains nothing an
 * operator can act on and it is what made the original toast unreadable.
 */
export function extractHtmlErrorText(html: string, maxLength = MAX_HTML_ERROR_TEXT_CHARS): string {
  const source = html.slice(0, MAX_HTML_PARSE_CHARS);

  const headings = [...source.matchAll(/<h[12]\b[^>]*>([\s\S]*?)<\/h[12]>/gi)]
    .map((m) => stripMarkup(m[1] ?? ''))
    .filter(Boolean);
  // An error headline is declarative ("Sorry, you have been blocked", "502 Bad
  // Gateway"); a question is the heading of a self-help section ("Why have I
  // been blocked?"), which is noise. Only drop them when something declarative
  // survives, so an all-questions page still says something.
  const statements = headings.filter((h) => !h.endsWith('?'));
  const preferred = statements.length > 0 ? statements : headings;
  const title = stripMarkup(/<title\b[^>]*>([\s\S]*?)<\/title>/i.exec(source)?.[1] ?? '');

  const candidates = preferred.length > 0 ? preferred : title ? [title] : [stripMarkup(source)];
  const text = [...new Set(candidates)].join(' — ').trim();

  return bound(text, maxLength);
}

export interface DisplayErrorTextOptions {
  /** Hard cap on the returned line. Defaults to {@link MAX_DISPLAY_ERROR_CHARS}. */
  maxLength?: number;
}

/**
 * Reduce any error string to one bounded, markup-free line fit for a toast, an
 * alert, or a log message.
 *
 * Three things can be wrong with the input, and all three are handled here:
 *
 *  1. **It is (or embeds) an HTML document.** SDKs splice a failing response's
 *     body straight into the message they throw, so the real string looks like
 *     `Error POSTing to endpoint: <!DOCTYPE html>…` — a readable prefix and
 *     then kilobytes of markup. The prefix is kept, the document is replaced by
 *     its own error sentence plus a Cloudflare Ray ID when one is present.
 *  2. **It is multi-line.** A banner is one line; newlines become spaces.
 *  3. **It is unbounded.** A stack trace is not a banner. Everything is capped.
 *
 * Total and pure: any string in, one display line out, so callers never need a
 * try/catch around presentation.
 */
export function toDisplayErrorText(raw: string | null | undefined, options: DisplayErrorTextOptions = {}): string {
  const { maxLength = MAX_DISPLAY_ERROR_CHARS } = options;
  const text = (raw ?? '').trim();
  if (!text) return '';

  const markupStart = MARKUP_START.exec(text);
  if (!markupStart) return bound(collapseWhitespace(text), maxLength);

  const prefix = collapseWhitespace(text.slice(0, markupStart.index));
  const markup = text.slice(markupStart.index);
  const detail = extractHtmlErrorText(markup) || EMPTY_HTML_PLACEHOLDER;
  const rayId = extractCloudflareRayId(markup);

  let line = prefix ? `${prefix} ${detail}` : detail;
  if (rayId && !line.includes(rayId)) line += ` (Cloudflare Ray ID: ${rayId})`;

  return bound(collapseWhitespace(line), maxLength);
}
