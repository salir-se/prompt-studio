// @module-tag dom
import type { BrowserState } from '@prompt-studio/control-protocol';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BROWSER_ID_STORAGE_KEY, connectWsControlChannel } from './ws-control-channel';

/**
 * The editor tab's WebSocket channel: what it says in hello, how it answers commands through the app's
 * resolver, when it publishes state, and when it reconnects or falls back to SSE. The socket is a scripted
 * fake; the gateway side is covered against real sockets in server/control-ws.
 */

class FakeSocket {
  static readonly OPEN = 1;
  static instances: FakeSocket[] = [];
  readonly sent: Record<string, unknown>[] = [];
  readyState = 0;
  private readonly listeners = new Map<string, Array<(event: unknown) => void>>();
  constructor(readonly url: string) {
    FakeSocket.instances.push(this);
  }
  addEventListener(type: string, listener: (event: unknown) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener]);
  }
  send(data: string) {
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close() {
    this.emit('close', {});
  }
  open() {
    this.readyState = 1;
    this.emit('open', {});
  }
  receive(message: unknown) {
    this.emit('message', { data: JSON.stringify(message) });
  }
  emit(type: string, event: unknown) {
    if (type === 'close') this.readyState = 3;
    for (const listener of this.listeners.get(type) ?? []) listener(event);
  }
}

const STATE: BrowserState = { ready: true, projectId: 'default', projectName: 'Default', documentId: null, view: null };

function memoryStorage(initial: Record<string, string> = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => void values.set(key, value),
    values,
  };
}

beforeEach(() => {
  FakeSocket.instances = [];
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'studio-token');
  meta.setAttribute('content', 'tab-token');
  document.head.append(meta);
});

afterEach(() => {
  document.head.querySelector('meta[name="studio-token"]')?.remove();
  vi.useRealTimers();
});

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('connectWsControlChannel', () => {
  it('says hello with the token, the stored browserId and the state, then answers commands through the resolver', async () => {
    // Given: a tab with a stored browserId and a resolver with one working and one failing command
    const storage = memoryStorage({ [BROWSER_ID_STORAGE_KEY]: 'tab-old' });
    const handle = connectWsControlChannel(
      (command) =>
        command === 'listDocuments'
          ? () => [{ id: 'scout' }]
          : command === 'editDocument'
            ? () => {
                throw new Error('Open "scout" first.');
              }
            : undefined,
      () => STATE,
      { WebSocketImpl: FakeSocket as unknown as typeof WebSocket, storage, fallback: () => () => {} },
    );
    const socket = FakeSocket.instances[0]!;
    // When: the socket opens
    socket.open();
    // Then: hello carries the role, token, resume id and state
    expect(socket.url).toMatch(/^ws:\/\/.+\/__control\/ws$/);
    expect(socket.sent[0]).toEqual({
      type: 'hello',
      role: 'browser',
      protocolVersions: ['1.0'],
      token: 'tab-token',
      state: STATE,
      resumeBrowserId: 'tab-old',
    });
    // When: the gateway welcomes it with a new id and sends three commands
    socket.receive({ type: 'welcome', browserId: 'tab-new' });
    socket.receive({ type: 'command', commandId: 'c1', action: 'listDocuments', params: {} });
    socket.receive({ type: 'command', commandId: 'c2', action: 'editDocument', params: {} });
    socket.receive({ type: 'command', commandId: 'c3', action: 'nope' });
    await flush();
    // Then: the id is stored and each command is answered with its result or readable error
    expect(storage.values.get(BROWSER_ID_STORAGE_KEY)).toBe('tab-new');
    expect(socket.sent.slice(1)).toEqual(
      expect.arrayContaining([
        { type: 'command.result', commandId: 'c1', ok: true, data: [{ id: 'scout' }] },
        { type: 'command.result', commandId: 'c2', ok: false, error: 'Open "scout" first.' },
        { type: 'command.result', commandId: 'c3', ok: false, error: 'Unknown command "nope".' },
      ]),
    );
    handle.close();
  });

  it('publishes state only after welcome and only when it changed', () => {
    // Given: a welcomed channel
    const handle = connectWsControlChannel(
      () => undefined,
      () => STATE,
      {
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
        storage: memoryStorage(),
        fallback: () => () => {},
      },
    );
    const socket = FakeSocket.instances[0]!;
    handle.publishState({ ...STATE, view: 'write' }); // before open: dropped
    socket.open();
    socket.receive({ type: 'welcome', browserId: 'tab-1' });
    // When: the same state is published, then a changed one twice
    handle.publishState(STATE);
    handle.publishState({ ...STATE, documentId: 'scout', view: 'write' });
    handle.publishState({ ...STATE, documentId: 'scout', view: 'write' });
    // Then: exactly one state.update was sent
    expect(socket.sent.filter((message) => message.type === 'state.update')).toEqual([
      { type: 'state.update', state: { ...STATE, documentId: 'scout', view: 'write' } },
    ]);
    handle.close();
  });

  it('falls back to SSE when the first connection fails, and reconnects (never falls back) after a welcome', () => {
    vi.useFakeTimers();
    // Given: a server without the gateway
    const fallback = vi.fn(() => () => {});
    connectWsControlChannel(
      () => undefined,
      () => STATE,
      {
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
        storage: memoryStorage(),
        fallback,
      },
    );
    // When: the first socket closes before welcome
    FakeSocket.instances[0]!.close();
    // Then: the SSE channel takes over
    expect(fallback).toHaveBeenCalledTimes(1);

    // Given: a channel that was welcomed once
    FakeSocket.instances = [];
    const secondFallback = vi.fn(() => () => {});
    const handle = connectWsControlChannel(
      () => undefined,
      () => STATE,
      {
        WebSocketImpl: FakeSocket as unknown as typeof WebSocket,
        storage: memoryStorage(),
        fallback: secondFallback,
        initialBackoffMs: 100,
      },
    );
    FakeSocket.instances[0]!.open();
    FakeSocket.instances[0]!.receive({ type: 'welcome', browserId: 'tab-1' });
    // When: the connection drops
    FakeSocket.instances[0]!.close();
    vi.advanceTimersByTime(200);
    // Then: it opens a new socket instead of falling back
    expect(FakeSocket.instances).toHaveLength(2);
    expect(secondFallback).not.toHaveBeenCalled();
    // And: close stops reconnecting
    handle.close();
    vi.advanceTimersByTime(20_000);
    expect(FakeSocket.instances).toHaveLength(2);
  });

  it('stays closed without a studio token', () => {
    // Given: no token meta tag
    document.head.querySelector('meta[name="studio-token"]')?.remove();
    // When: the channel is opened
    connectWsControlChannel(
      () => undefined,
      () => STATE,
      { WebSocketImpl: FakeSocket as unknown as typeof WebSocket },
    );
    // Then: no socket is created
    expect(FakeSocket.instances).toHaveLength(0);
  });
});
