// @module-tag pure
import { describe, expect, it } from 'vitest';
import { formatProviderErrorDetail } from './provider-error-detail';

function makeResponse(opts: { headers?: Record<string, string> } = {}): Response {
  const headers = new Headers(opts.headers ?? {});
  return { headers, status: 400, ok: false } as unknown as Response;
}

describe('formatProviderErrorDetail', () => {
  it('returns empty string for empty body + no request id', () => {
    expect(formatProviderErrorDetail(makeResponse(), '')).toBe('');
  });

  it('extracts Anthropic-shape error message and type', () => {
    const body = JSON.stringify({
      type: 'error',
      error: { type: 'authentication_error', message: 'invalid x-api-key' },
    });
    const detail = formatProviderErrorDetail(makeResponse(), body);
    expect(detail).toContain('authentication_error: invalid x-api-key');
    expect(detail.startsWith(' — ')).toBe(true);
  });

  it('extracts OpenAI-shape error message + type', () => {
    const body = JSON.stringify({
      error: { message: "Unsupported parameter: 'max_tokens'", type: 'invalid_request_error', param: 'max_tokens' },
    });
    const detail = formatProviderErrorDetail(makeResponse(), body);
    expect(detail).toContain("Unsupported parameter: 'max_tokens'");
    expect(detail).toContain('invalid_request_error');
  });

  it('falls back to the inner type when message is missing', () => {
    const body = JSON.stringify({ error: { type: 'rate_limit_error' } });
    expect(formatProviderErrorDetail(makeResponse(), body)).toContain('rate_limit_error');
  });

  it('surfaces the request-id header from Anthropic responses', () => {
    const res = makeResponse({ headers: { 'request-id': 'req_abc123' } });
    expect(formatProviderErrorDetail(res, '')).toContain('request-id=req_abc123');
  });

  it('also accepts x-request-id (some upstreams emit only that variant)', () => {
    const res = makeResponse({ headers: { 'x-request-id': 'r-xyz' } });
    expect(formatProviderErrorDetail(res, '')).toContain('request-id=r-xyz');
  });

  it('joins request-id and parsed message with a comma', () => {
    const res = makeResponse({ headers: { 'request-id': 'req_99' } });
    const detail = formatProviderErrorDetail(res, JSON.stringify({ error: { message: 'boom' } }));
    expect(detail).toMatch(/request-id=req_99,\s.*boom/);
  });

  it('caps non-JSON bodies at 200 chars to avoid drowning the log', () => {
    const html = `<html>${'x'.repeat(500)}</html>`;
    const detail = formatProviderErrorDetail(makeResponse(), html);
    // 200 char cap + leading " — " prefix
    expect(detail.length).toBeLessThanOrEqual(' — '.length + 200);
    expect(detail).toContain('…');
  });

  it('renders a Salir Worker error envelope as its human message, code and correlation id', () => {
    // Given: the typed answer the Hosted LLM Worker gives when Workers AI times out.
    const body = JSON.stringify({
      ok: false,
      error: 'The hosted model (glm-5.3-flash) timed out after 4 minutes on Cloudflare Workers AI (code 3046).',
      details: {
        code: 'upstream_timeout',
        message: 'The hosted model (glm-5.3-flash) timed out after 4 minutes on Cloudflare Workers AI (code 3046).',
        correlationId: 'req-scheduler-7f3a',
        service: 'salir-ai',
        detail: { workersAiCode: 3046, elapsedMs: 235_412, retryable: true, model: 'glm-5.3-flash' },
      },
    });
    // When: the detail is formatted.
    const detail = formatProviderErrorDetail(makeResponse(), body);
    // Then: the user reads the cause in plain words, then the code and the id support needs — never the raw JSON.
    expect(detail).toBe(
      ' — The hosted model (glm-5.3-flash) timed out after 4 minutes on Cloudflare Workers AI (code 3046).' +
        ' (upstream_timeout, correlationId=req-scheduler-7f3a)',
    );
  });

  it('renders the generic Salir envelope by its message rather than echoing the JSON', () => {
    // Given: the generic 500 envelope `createOnError` answers for an unexpected fault.
    const body = JSON.stringify({
      ok: false,
      error: 'Internal Server Error',
      details: { code: 'internal_error', message: 'Internal Server Error', correlationId: 'corr-1' },
    });
    // When: the detail is formatted.
    // Then: it names the message, code and correlation id.
    expect(formatProviderErrorDetail(makeResponse(), body)).toBe(
      ' — Internal Server Error (internal_error, correlationId=corr-1)',
    );
  });

  it('is defensive against duck-typed mock responses missing headers', () => {
    const mockRes = { status: 401, ok: false } as unknown as Response;
    expect(() => formatProviderErrorDetail(mockRes, JSON.stringify({ error: { message: 'x' } }))).not.toThrow();
  });
});
