// @module-tag dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { connectControlChannel } from './control-channel';

/**
 * The browser half of the control channel: SSE frames become handler calls, and results/errors
 * go back over the response POST in the exact wire shape the server's hub routes. A fake
 * EventSource + stubbed fetch keep this pure — the server side has its own route tests.
 */

interface FakeEventSource {
  onmessage: ((event: { data: string }) => void) | null;
  close: () => void;
}

let fakeSources: FakeEventSource[] = [];
let lastSourceUrl = '';

function installFakeEventSource(): void {
  fakeSources = [];
  lastSourceUrl = '';
  class FakeEventSourceImpl implements FakeEventSource {
    onmessage: ((event: { data: string }) => void) | null = null;
    closed = false;
    constructor(readonly url: string) {
      lastSourceUrl = url;
      fakeSources.push(this);
    }
    close(): void {
      this.closed = true;
    }
  }
  vi.stubGlobal('EventSource', FakeEventSourceImpl);
}

function setStudioToken(token = 'test-token'): void {
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'studio-token');
  meta.setAttribute('content', token);
  document.head.appendChild(meta);
}

afterEach(() => {
  for (const meta of document.head.querySelectorAll('meta[name="studio-token"]')) {
    meta.remove();
  }
  vi.unstubAllGlobals();
});

function lastPost(): { url: string; body: Record<string, unknown>; token: string } | null {
  const mock = (globalThis as { fetch?: unknown }).fetch as ReturnType<typeof vi.fn>;
  const call = mock.mock.calls.at(-1);
  if (!call) return null;
  const [url, init] = call as [string, RequestInit];
  return {
    url: String(url),
    body: JSON.parse(String(init.body)) as Record<string, unknown>,
    token: (init.headers as Record<string, string>)['x-studio-token'],
  };
}

describe('connectControlChannel', () => {
  it('stays closed without a studio token — the studio works exactly as before', () => {
    const close = connectControlChannel(() => undefined);
    expect(close()).toBeUndefined();
  });

  it('resolves commands through the resolver and POSTs results in the hub wire shape', async () => {
    setStudioToken();
    installFakeEventSource();
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    const handler = vi.fn(async () => ({ documents: ['scout'] }));
    connectControlChannel((command) => (command === 'listDocuments' ? handler : undefined));

    const source = fakeSources[0];
    expect(source).toBeTruthy();
    expect(lastSourceUrl).toContain('/__control/events?token=test-token');
    source!.onmessage?.({ data: JSON.stringify({ id: 7, command: 'listDocuments' }) });

    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(handler).toHaveBeenCalledWith(undefined);
    expect(lastPost()).toEqual({
      url: '/__control/response',
      body: { id: 7, ok: true, result: { documents: ['scout'] } },
      token: 'test-token',
    });
  });

  it('answers unknown commands and handler failures with readable errors', async () => {
    setStudioToken();
    installFakeEventSource();
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal('fetch', fetchMock);

    connectControlChannel((command) =>
      command === 'editDocument'
        ? async () => {
            throw new Error('Open "scout" first.');
          }
        : undefined,
    );

    const source = fakeSources[0];
    source!.onmessage?.({ data: JSON.stringify({ id: 8, command: 'editDocument' }) });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(lastPost()?.body).toEqual({ id: 8, ok: false, error: 'Open "scout" first.' });

    source!.onmessage?.({ data: JSON.stringify({ id: 9, command: 'nonsense' }) });
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(lastPost()?.body).toEqual({ id: 9, ok: false, error: 'Unknown command "nonsense".' });
  });
});
