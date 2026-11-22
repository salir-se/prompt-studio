// @module-tag dom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { studioJson } from './prompt-repo-client';

const pathname = '/__studio/prompt-repo/draft';
const init = { method: 'POST', body: '{"projectId":"one","revision":7,"documents":[{"text":"Keep my draft"}]}' };
const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
let request: ReturnType<typeof vi.fn>;

beforeEach(() => {
  document.head.insertAdjacentHTML('beforeend', '<meta name="studio-token" content="old-token">');
  request = vi.fn();
  vi.stubGlobal('fetch', request);
});
afterEach(() => {
  document.querySelector('meta[name="studio-token"]')?.remove();
  vi.unstubAllGlobals();
});

it.each([403, 409, 400, 500])('#2518: never refreshes or retries a non-auth failure (%s)', async (status) => {
  // Given: a save failed for a reason other than a rotated token.
  request.mockResolvedValue(reply(status, { error: 'Original failure' }));
  // When: the client receives the failure.
  await expect(studioJson(pathname, init)).rejects.toThrow('Original failure');
  // Then: only the original request was sent.
  expect(request).toHaveBeenCalledTimes(1);
  expect(request).toHaveBeenCalledWith(pathname, expect.objectContaining(init));
});

it.each([
  null,
  {},
  { ok: true },
  { ok: true, token: '' },
  { ok: true, token: 42 },
  { ok: false, token: 'current' },
  { ok: true, token: 'bad\ntoken' },
  { ok: true, token: 'current', extra: true },
])('#2518: rejects malformed refresh responses without replaying the save (%j)', async (body) => {
  // Given: an expired session and an invalid token refresh response.
  request.mockResolvedValueOnce(reply(401, { error: 'Unauthorized.' })).mockResolvedValueOnce(reply(200, body));
  // When: the old client tries to save.
  await expect(studioJson(pathname, init)).rejects.toThrow(/Retry saving.*export/i);
  // Then: the draft request was never repeated, and the old token was not replaced.
  expect(request).toHaveBeenCalledTimes(2);
  expect(document.querySelector('meta[name="studio-token"]')?.getAttribute('content')).toBe('old-token');
});

it.each(['offline', 'invalid JSON', 'denied', 'retry unauthorized', 'retry conflict', 'retry offline'])(
  '#2518: a failed refresh or retry stops with an actionable error (%s)',
  async (failure) => {
    // Given: an old token and a failed recovery stage.
    request.mockResolvedValueOnce(reply(401, { error: 'Unauthorized.' }));
    if (failure === 'offline') request.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    else if (failure === 'invalid JSON') request.mockResolvedValueOnce(new Response('<html>Unavailable</html>'));
    else if (failure === 'denied') request.mockResolvedValueOnce(reply(403, { error: 'Forbidden.' }));
    else {
      request.mockResolvedValueOnce(reply(200, { ok: true, token: 'current-token' }));
      if (failure === 'retry offline') request.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      else request.mockResolvedValueOnce(reply(failure === 'retry conflict' ? 409 : 401, { error: 'Save rejected.' }));
    }
    // When: the user saves once.
    await expect(studioJson(pathname, init)).rejects.toThrow(/Retry saving.*export/i);
    // Then: no recovery loop occurs; the original request is retained byte for byte.
    expect(request).toHaveBeenCalledTimes(failure.startsWith('retry') ? 3 : 2);
    expect(request.mock.calls[0][1].body).toBe(init.body);
    if (failure.startsWith('retry')) expect(request.mock.calls[2][1].body).toBe(init.body);
  },
);

it('#2518: reuses the refreshed token on the next request', async () => {
  // Given: one expired request followed by a valid refresh and two successful saves.
  request
    .mockResolvedValueOnce(reply(401, {}))
    .mockResolvedValueOnce(reply(200, { ok: true, token: 'current-token' }))
    .mockImplementation(async () => reply(200, { ok: true }));
  // When: the user saves twice without a page reload.
  await studioJson(pathname, init);
  await studioJson(pathname, init);
  // Then: the second save needs no additional refresh and uses the current token.
  expect(request).toHaveBeenCalledTimes(4);
  expect(new Headers(request.mock.calls[3][1].headers).get('x-studio-token')).toBe('current-token');
});
