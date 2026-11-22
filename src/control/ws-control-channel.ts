/**
 * The browser half of WebSocket remote control (docs/remote-control.md; spec phase 1): the editor tab connects
 * to the gateway at `/__control/ws` as a `browser`, reports its state, and answers each command through the
 * SAME resolver as the SSE channel — the app's own handlers.
 *
 * Identity: the gateway assigns a `browserId`; the tab keeps it in sessionStorage and asks for it again after
 * a reload (`resumeBrowserId`), so a CLI that targeted this tab can keep doing so. The gateway grants it only
 * when no live socket holds it.
 *
 * Fallback: without WebSocket, or when the very first connection fails (an older server), the tab uses the
 * deprecated SSE channel instead (`connectControlChannel`). After one successful connection it reconnects
 * with backoff and never falls back.
 */

import { type BrowserState, CONTROL_WS_PATH, SUPPORTED_PROTOCOL_VERSIONS } from '@prompt-studio/control-protocol';
import { type ControlHandler, connectControlChannel } from './control-channel';

export const BROWSER_ID_STORAGE_KEY = 'prompt-studio.control.browserId';

export interface ControlChannelHandle {
  /** Sends `state.update` when the state differs from what the gateway last saw. */
  publishState(state: BrowserState): void;
  close(): void;
}

export interface WsControlChannelOptions {
  readonly WebSocketImpl?: typeof WebSocket;
  readonly storage?: Pick<Storage, 'getItem' | 'setItem'> | null;
  /** Called instead of the SSE channel when the first WebSocket connection fails (tests). */
  readonly fallback?: () => () => void;
  readonly initialBackoffMs?: number;
  readonly maxBackoffMs?: number;
}

function readStudioToken(): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('meta[name="studio-token"]')?.getAttribute('content') ?? null;
}

function sessionStore(): Pick<Storage, 'getItem' | 'setItem'> | null {
  try {
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

const NOOP_HANDLE: ControlChannelHandle = { publishState: () => {}, close: () => {} };

/**
 * Opens the channel; returns a handle. `getState` is read for the `hello` of every (re)connection, so a
 * reconnect always reports the current state.
 */
export function connectWsControlChannel(
  resolve: (command: string) => ControlHandler | undefined,
  getState: () => BrowserState,
  options: WsControlChannelOptions = {},
): ControlChannelHandle {
  if (typeof document === 'undefined' || typeof location === 'undefined') return NOOP_HANDLE;
  const token = readStudioToken();
  if (!token) return NOOP_HANDLE;
  const fallback = options.fallback ?? (() => connectControlChannel(resolve));
  const Impl = options.WebSocketImpl ?? (typeof WebSocket === 'undefined' ? undefined : WebSocket);
  if (Impl === undefined) {
    const close = fallback();
    return { publishState: () => {}, close };
  }
  const storage = options.storage === undefined ? sessionStore() : options.storage;
  const initialBackoffMs = options.initialBackoffMs ?? 500;
  const maxBackoffMs = options.maxBackoffMs ?? 10_000;
  const url = `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}${CONTROL_WS_PATH}`;

  let socket: WebSocket | null = null;
  let welcomed = false;
  let everWelcomed = false;
  let closed = false;
  let attempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let closeFallback: (() => void) | null = null;
  let lastSent = '';

  const send = (message: Record<string, unknown>) => {
    if (socket !== null && socket.readyState === Impl.OPEN) socket.send(JSON.stringify(message));
  };

  const answer = (commandId: string, action: string, params: unknown) => {
    const handler = resolve(action);
    if (handler === undefined) {
      send({ type: 'command.result', commandId, ok: false, error: `Unknown command "${action}".` });
      return;
    }
    Promise.resolve()
      .then(() => handler(params ?? {}))
      .then((data) => send({ type: 'command.result', commandId, ok: true, data: data ?? null }))
      .catch((error: unknown) => {
        // The handler's message is the CLI/MCP user's diagnostic — readable, never a stack dump.
        send({
          type: 'command.result',
          commandId,
          ok: false,
          error: error instanceof Error ? error.message : String(error),
        });
      });
  };

  const connect = () => {
    welcomed = false;
    const state = getState();
    let resumeBrowserId: string | null = null;
    try {
      resumeBrowserId = storage?.getItem(BROWSER_ID_STORAGE_KEY) ?? null;
    } catch {
      resumeBrowserId = null;
    }
    const current = new Impl(url);
    socket = current;
    current.addEventListener('open', () => {
      lastSent = JSON.stringify(state);
      current.send(
        JSON.stringify({
          type: 'hello',
          role: 'browser',
          protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
          token,
          state,
          ...(resumeBrowserId === null ? {} : { resumeBrowserId }),
        }),
      );
    });
    current.addEventListener('message', (event: MessageEvent) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(String(event.data)) as Record<string, unknown>;
      } catch {
        return;
      }
      if (message.type === 'welcome') {
        welcomed = true;
        everWelcomed = true;
        attempt = 0;
        if (typeof message.browserId === 'string') {
          try {
            storage?.setItem(BROWSER_ID_STORAGE_KEY, message.browserId);
          } catch {
            // Storage blocked: the tab gets a new id after a reload, nothing else changes.
          }
        }
        // State may have changed between `hello` and `welcome`.
        publishState(getState());
        return;
      }
      if (message.type === 'command' && welcomed) {
        if (typeof message.commandId !== 'string' || typeof message.action !== 'string') return;
        answer(message.commandId, message.action, message.params);
      }
    });
    current.addEventListener('close', () => {
      if (socket !== current) return;
      socket = null;
      welcomed = false;
      if (closed) return;
      if (!everWelcomed) {
        // The first connection never completed: this server has no WebSocket gateway (or refuses us).
        closeFallback = fallback();
        return;
      }
      const delay = Math.min(maxBackoffMs, initialBackoffMs * 2 ** attempt) * (0.75 + Math.random() * 0.5);
      attempt += 1;
      reconnectTimer = setTimeout(connect, delay);
    });
  };

  const publishState = (state: BrowserState) => {
    const serialized = JSON.stringify(state);
    if (!welcomed || serialized === lastSent) return;
    lastSent = serialized;
    send({ type: 'state.update', state });
  };

  connect();
  return {
    publishState,
    close() {
      closed = true;
      if (reconnectTimer !== null) clearTimeout(reconnectTimer);
      closeFallback?.();
      socket?.close(1000);
      socket = null;
    },
  };
}
