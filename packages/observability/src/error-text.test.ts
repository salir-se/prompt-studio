// @module-tag pure
import { describe, expect, it } from 'vitest';
import {
  extractCloudflareRayId,
  extractHtmlErrorText,
  isHtmlMediaType,
  MAX_DISPLAY_ERROR_CHARS,
  toDisplayErrorText,
} from './error-text';

/**
 * The exact shape a customer screenshotted on the Outreach tab: a Closer job
 * dead-lettered with the MCP SDK's `Error POSTing to endpoint: …` message, the
 * entire Cloudflare WAF block page spliced in verbatim behind it.
 */
const CLOUDFLARE_BLOCK_PAGE = `<!DOCTYPE html>
<!--[if lt IE 7]> <html class="no-js ie6 oldie" lang="en-US"> <![endif]-->
<!--[if gt IE 8]><!--> <html class="no-js" lang="en-US"> <!--<![endif]-->
<head>
<title>Attention Required! | Cloudflare</title>
<meta charset="UTF-8" />
<link rel="stylesheet" id="cf_styles-css" href="/cdn-cgi/styles/cf.errors.css" />
<style>body{margin:0;padding:0}</style>
<script>
  if (!navigator.cookieEnabled) {
    window.addEventListener('DOMContentLoaded', function () {
      var cookieEl = document.getElementById('cookie-alert');
      cookieEl.style.display = 'block';
    })
  }
</script>
</head>
<body>
  <div id="cf-wrapper">
    <div class="cf-alert cf-alert-error cf-cookie-error" id="cookie-alert" data-translate="enable_cookies">Please enable cookies.</div>
    <div id="cf-error-details" class="cf-error-details-wrapper">
      <div class="cf-wrapper cf-header cf-error-overview">
        <h1 data-translate="block_headline">Sorry, you have been blocked</h1>
        <h2 class="cf-subheadline"><span data-translate="unable_to_access">You are unable to access</span> mcp.exa.ai</h2>
      </div>
      <div class="cf-section cf-wrapper">
        <div class="cf-columns two">
          <div class="cf-column">
            <h2 data-translate="blocked_why_headline">Why have I been blocked?</h2>
            <p data-translate="blocked_why_detail">This website is using a security service to protect itself from online attacks. The action you just performed triggered the security solution. There are several actions that could trigger this block including submitting a certain word or phrase, a SQL command or malformed data.</p>
          </div>
          <div class="cf-column">
            <h2 data-translate="blocked_resolve_headline">What can I do to resolve this?</h2>
            <p data-translate="blocked_resolve_detail">You can email the site owner to let them know you were blocked.</p>
          </div>
        </div>
      </div>
      <div class="cf-error-footer cf-wrapper">
        <p class="text-13">
          <span class="cf-footer-item sm:block sm:mb-1">Cloudflare Ray ID: <strong class="font-semibold">a264ec4249f04e58</strong></span>
          <span class="cf-footer-separator sm:hidden">&bull;</span>
          <span id="cf-footer-item-ip" class="cf-footer-item hidden sm:block sm:mb-1">
            Your IP: <span class="hidden" id="cf-footer-ip">2a06:98c0:3600::103</span>
          </span>
          <span class="cf-footer-item sm:block sm:mb-1"><span>Performance &amp; security by</span> <a href="https://www.cloudflare.com/5xx-error-landing" id="brand_link" target="_blank">Cloudflare</a></span>
        </p>
      </div>
    </div>
  </div>
  <script>window._cf_translation = {};</script>
</body>
</html>`;

const REPORTED_CLOSER_ERROR = `Streamable HTTP error: Error POSTing to endpoint: ${CLOUDFLARE_BLOCK_PAGE}`;

describe('isHtmlMediaType', () => {
  it.each([
    ['text/html', true],
    ['TEXT/HTML; charset=UTF-8', true],
    ['text/html;charset=utf-8', true],
    ['application/json', false],
    ['text/event-stream', false],
    ['text/plain', false],
    [null, false],
    [undefined, false],
  ])('%s → %s', (contentType, expected) => {
    expect(isHtmlMediaType(contentType)).toBe(expected);
  });
});

describe('extractCloudflareRayId', () => {
  it('reads the Ray ID out of the footer, through the nested <strong>', () => {
    expect(extractCloudflareRayId(CLOUDFLARE_BLOCK_PAGE)).toBe('a264ec4249f04e58');
  });

  it('returns undefined for a page without one', () => {
    expect(extractCloudflareRayId('<html><body><h1>502 Bad Gateway</h1></body></html>')).toBeUndefined();
  });
});

describe('extractHtmlErrorText', () => {
  it('prefers declarative headings and drops the self-help questions', () => {
    const text = extractHtmlErrorText(CLOUDFLARE_BLOCK_PAGE);
    expect(text).toBe('Sorry, you have been blocked — You are unable to access mcp.exa.ai');
    expect(text).not.toContain('Why have I been blocked?');
    expect(text).not.toContain('security service');
  });

  it('keeps question headings when nothing declarative survives', () => {
    expect(extractHtmlErrorText('<html><body><h1>Are you a robot?</h1></body></html>')).toBe('Are you a robot?');
  });

  it('falls back to <title> when the page has no headings', () => {
    expect(extractHtmlErrorText('<html><head><title>504 Gateway Timeout</title></head><body></body></html>')).toBe(
      '504 Gateway Timeout',
    );
  });

  it('falls back to the stripped body when there is no heading and no title', () => {
    expect(extractHtmlErrorText('<html><body><p>Upstream refused the connection.</p></body></html>')).toBe(
      'Upstream refused the connection.',
    );
  });

  it('bounds the result and marks the truncation', () => {
    const long = `<h1>${'x'.repeat(500)}</h1>`;
    const text = extractHtmlErrorText(long, 40);
    expect(text).toHaveLength(40);
    expect(text.endsWith('…')).toBe(true);
  });
});

describe('toDisplayErrorText', () => {
  it('returns ordinary error text unchanged', () => {
    expect(toDisplayErrorText('API rate limit exceeded — retry after 60 seconds')).toBe(
      'API rate limit exceeded — retry after 60 seconds',
    );
  });

  it.each([undefined, null, '', '   '])('collapses %p to an empty string', (raw) => {
    expect(toDisplayErrorText(raw)).toBe('');
  });

  // The reported defect: ~4 KB of Cloudflare markup rendered verbatim inside the
  // Outreach tab's destructive alert.
  it('reduces the reported Closer failure to a single readable line', () => {
    expect(toDisplayErrorText(REPORTED_CLOSER_ERROR)).toBe(
      'Streamable HTTP error: Error POSTing to endpoint: Sorry, you have been blocked — ' +
        'You are unable to access mcp.exa.ai (Cloudflare Ray ID: a264ec4249f04e58)',
    );
  });

  it('lets no markup, script, style or entity escape to the UI', () => {
    const text = toDisplayErrorText(REPORTED_CLOSER_ERROR);
    expect(text).not.toMatch(/[<>]/);
    expect(text).not.toContain('DOCTYPE');
    expect(text).not.toContain('cookieEl');
    expect(text).not.toContain('margin:0');
    expect(text).not.toContain('&bull;');
    expect(text).not.toContain('&amp;');
  });

  it('keeps the whole line inside the display bound', () => {
    expect(toDisplayErrorText(REPORTED_CLOSER_ERROR).length).toBeLessThanOrEqual(MAX_DISPLAY_ERROR_CHARS);
  });

  it('handles an HTML body with no plain-text prefix', () => {
    expect(toDisplayErrorText('<html><head><title>502 Bad Gateway</title></head><body></body></html>')).toBe(
      '502 Bad Gateway',
    );
  });

  it('reads an nginx-style upstream page', () => {
    const nginx =
      'fetch failed: <html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n' +
      '<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx/1.24.0</center>\r\n</body>\r\n</html>\r\n';
    expect(toDisplayErrorText(nginx)).toBe('fetch failed: 502 Bad Gateway');
  });

  it('names the failure when the page carries no readable text at all', () => {
    expect(toDisplayErrorText('POST failed: <html><body><div></div></body></html>')).toBe(
      'POST failed: (HTML error page)',
    );
  });

  // Angle brackets are ordinary punctuation in error prose — only real markup
  // may trigger the strip, or a validation message loses the field it names.
  it.each([
    'Unsupported key <apiKey> in request body',
    'Expected value < 3, received 7',
    'Set FROM_EMAIL to <you>@example.com',
  ])('leaves plain text containing angle brackets alone: %s', (raw) => {
    expect(toDisplayErrorText(raw)).toBe(raw);
  });

  it('collapses newlines and runs of whitespace into single spaces', () => {
    expect(toDisplayErrorText('Line one\n\n   Line two\t\tLine three')).toBe('Line one Line two Line three');
  });

  it('bounds a long plain-text error (a stack trace is not a banner)', () => {
    const trace = `Boom\n${'  at someFrame (/app/src/very/long/path/file.ts:12:34)\n'.repeat(200)}`;
    const text = toDisplayErrorText(trace);
    expect(text).toHaveLength(MAX_DISPLAY_ERROR_CHARS);
    expect(text.endsWith('…')).toBe(true);
    expect(text.startsWith('Boom at someFrame')).toBe(true);
  });

  it('honours an explicit maxLength', () => {
    expect(toDisplayErrorText('a'.repeat(100), { maxLength: 10 })).toBe(`${'a'.repeat(9)}…`);
  });

  it('is idempotent — sanitizing an already-clean message changes nothing', () => {
    const once = toDisplayErrorText(REPORTED_CLOSER_ERROR);
    expect(toDisplayErrorText(once)).toBe(once);
  });
});
