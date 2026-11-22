// @module-tag dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendZaiMessage, ZAI_DEFAULT_MODEL } from './zai-client';

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendZaiMessage', () => {
  it('posts to the z.ai Anthropic-compatible endpoint with the key and version headers', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('https://api.z.ai/api/anthropic/v1/messages');
      const headers = init?.headers as Record<string, string>;
      expect(headers['x-api-key']).toBe('sk-test');
      expect(headers['anthropic-version']).toBe('2023-06-01');
      const body = JSON.parse(String(init?.body)) as { model: string; system: string; messages: unknown[] };
      expect(body.model).toBe(ZAI_DEFAULT_MODEL);
      expect(body.system).toContain('Prompt Studio');
      expect(body.messages).toEqual([{ role: 'user', content: 'how do I reset?' }]);
      return jsonResponse(200, { content: [{ type: 'text', text: 'Open History and press Reset.' }] });
    });
    vi.stubGlobal('fetch', fetchMock);

    const { text } = await sendZaiMessage({
      apiKey: 'sk-test',
      system: 'You help with Prompt Studio.',
      messages: [{ role: 'user', content: 'how do I reset?' }],
    });
    expect(text).toBe('Open History and press Reset.');
  });

  it('joins multiple text blocks and trims', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse(200, {
          content: [
            { type: 'text', text: 'Part one. ' },
            { type: 'text', text: 'Part two.' },
          ],
        }),
      ),
    );
    const { text } = await sendZaiMessage({ apiKey: 'k', system: 's', messages: [{ role: 'user', content: 'q' }] });
    expect(text).toBe('Part one. \nPart two.');
  });

  it('surfaces the API error message without ever including the key', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(401, { error: { type: 'authentication_error', message: 'invalid x-api-key' } })),
    );
    const error = await sendZaiMessage({ apiKey: 'sk-secret', system: 's', messages: [] }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain('HTTP 401');
    expect((error as Error).message).toContain('invalid x-api-key');
    expect((error as Error).message).not.toContain('sk-secret');
  });

  it('rejects an unusable response body with a readable error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { content: 'not-an-array' })),
    );
    await expect(sendZaiMessage({ apiKey: 'k', system: 's', messages: [] })).rejects.toThrow(
      'unexpected response shape',
    );
  });
});
