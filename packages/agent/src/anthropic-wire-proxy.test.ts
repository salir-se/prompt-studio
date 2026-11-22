// @module-tag pure
/**
 * Contract for the ONE shared implementation of the authenticated Salir
 * Anthropic-wire proxy envelope and its Salir-vs-vendor error attribution.
 *
 * Both `./providers/anthropic.ts` (the `LlmProvider` adapter) and `./api.ts`
 * (the legacy `callWithRetry` loop a QUEUED run takes) call these helpers, so
 * pinning them here is what stops the two paths drifting — the drift that let
 * a queued z.ai run POST api.z.ai directly long after the provider path had
 * been fixed.
 */
import { describe, expect, it } from 'vitest';
import {
  anthropicWireProxyFailureMessage,
  anthropicWireProxyHeaders,
  buildAnthropicWireProxyBody,
  hasSalirLlmUpstreamMarker,
  SALIR_LLM_UPSTREAM_HEADER,
  salirApiErrorCode,
} from './anthropic-wire-proxy';

const REQUEST = JSON.stringify({ model: 'glm-5.1', max_tokens: 4096, messages: [{ role: 'user', content: 'hi' }] });

describe('buildAnthropicWireProxyBody', () => {
  it('emits exactly { baseUrl, apiKey, request } — the frozen BFF envelope', () => {
    const sent = JSON.parse(buildAnthropicWireProxyBody('https://api.z.ai/api/anthropic', 'sk-zai', REQUEST));

    expect(Object.keys(sent).sort()).toEqual(['apiKey', 'baseUrl', 'request']);
    expect(sent.baseUrl).toBe('https://api.z.ai/api/anthropic');
    expect(sent.apiKey).toBe('sk-zai');
    expect(sent.request).toEqual(JSON.parse(REQUEST));
  });

  it('carries the verbatim request, including a streaming body', () => {
    const streaming = JSON.stringify({ model: 'glm-5.1', messages: [], stream: true });
    const sent = JSON.parse(buildAnthropicWireProxyBody('https://api.z.ai/api/anthropic', 'sk-zai', streaming));

    expect(sent.request.stream).toBe(true);
  });
});

describe('anthropicWireProxyHeaders', () => {
  it('sends only Content-Type plus the caller session headers — never a vendor credential', async () => {
    const headers = await anthropicWireProxyHeaders({
      url: 'https://bff.salir.test/llm/messages',
      headers: { Authorization: 'Bearer session' },
    });

    expect(headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer session' });
    expect(headers['x-api-key']).toBeUndefined();
    expect(headers['anthropic-version']).toBeUndefined();
    expect(headers['anthropic-dangerous-direct-browser-access']).toBeUndefined();
  });

  it('tolerates an absent headers bag', async () => {
    expect(await anthropicWireProxyHeaders({ url: 'https://bff.salir.test/llm/messages' })).toEqual({
      'Content-Type': 'application/json',
    });
  });

  it('resolves a headers getter on every call so a rotated session bearer is sent', async () => {
    const tokens = ['Bearer first', 'Bearer second'];
    const proxy = {
      url: 'https://bff.salir.test/llm/messages',
      headers: () => ({ Authorization: tokens.shift() ?? 'Bearer missing' }),
    };

    expect(await anthropicWireProxyHeaders(proxy)).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer first',
    });
    expect(await anthropicWireProxyHeaders(proxy)).toEqual({
      'Content-Type': 'application/json',
      Authorization: 'Bearer second',
    });
  });
});

describe('salirApiErrorCode', () => {
  it('extracts details.code from the canonical Salir apiError envelope', () => {
    const body = JSON.stringify({
      ok: false,
      error: 'LLM provider request failed',
      details: { code: 'upstream_error', message: 'boom', correlationId: 'corr-1' },
    });

    expect(salirApiErrorCode(body)).toBe('upstream_error');
  });

  it('returns null for an Anthropic-wire vendor error, an empty body, and non-JSON', () => {
    expect(
      salirApiErrorCode('{"type":"error","error":{"type":"authentication_error","message":"bad key"}}'),
    ).toBeNull();
    expect(salirApiErrorCode('')).toBeNull();
    expect(salirApiErrorCode('   ')).toBeNull();
    expect(salirApiErrorCode('Not Found')).toBeNull();
    expect(salirApiErrorCode('[]')).toBeNull();
    expect(salirApiErrorCode('{"details":null}')).toBeNull();
    expect(salirApiErrorCode('{"details":{"code":""}}')).toBeNull();
  });
});

describe('hasSalirLlmUpstreamMarker', () => {
  it('is true only when the response carries the exposed upstream marker', () => {
    expect(hasSalirLlmUpstreamMarker({ headers: new Headers({ [SALIR_LLM_UPSTREAM_HEADER]: 'anthropic-wire' }) })).toBe(
      true,
    );
    expect(hasSalirLlmUpstreamMarker({ headers: new Headers() })).toBe(false);
  });

  it('tolerates a response double with no headers object at all', () => {
    expect(hasSalirLlmUpstreamMarker({} as { headers?: Headers })).toBe(false);
  });
});

describe('anthropicWireProxyFailureMessage — fail-open attribution', () => {
  it('attributes nothing when the upstream marker is present (the request reached the vendor)', () => {
    expect(anthropicWireProxyFailureMessage({ status: 401, body: 'nope', hasUpstreamMarker: true })).toBeNull();
    expect(anthropicWireProxyFailureMessage({ status: 404, body: 'Not Found', hasUpstreamMarker: true })).toBeNull();
  });

  it('names the Salir proxy for a marker-less 404 — the deploy-skew case', () => {
    const message = anthropicWireProxyFailureMessage({ status: 404, body: 'Not Found', hasUpstreamMarker: false });

    expect(message).toMatch(/Salir LLM proxy is unavailable \(404 Not Found\)/);
  });

  it('names the code for a marker-less Salir apiError envelope', () => {
    const body = JSON.stringify({
      ok: false,
      error: 'LLM provider request failed',
      details: { code: 'upstream_error', message: 'boom', correlationId: 'corr-1' },
    });

    expect(anthropicWireProxyFailureMessage({ status: 502, body, hasUpstreamMarker: false })).toBe(
      `Salir LLM proxy request failed (upstream_error): 502 ${body}`,
    );
  });

  it('falls open to vendor attribution for a marker-less response that is neither', () => {
    // Marker absence is not proof of a proxy failure — one CORS
    // header-exposure regression would otherwise make every vendor rejection
    // read as "Salir is down".
    expect(
      anthropicWireProxyFailureMessage({ status: 500, body: 'Internal Server Error', hasUpstreamMarker: false }),
    ).toBeNull();
    expect(
      anthropicWireProxyFailureMessage({
        status: 401,
        body: '{"type":"error","error":{"type":"authentication_error","message":"bad key"}}',
        hasUpstreamMarker: false,
      }),
    ).toBeNull();
  });
});
