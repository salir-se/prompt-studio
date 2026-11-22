import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Duplex } from 'node:stream';
import {
  type BrowserState,
  CLOSE_CODES,
  COMMAND_CATALOG,
  type CommandResultMessage,
  type ControlError,
  CONTROL_WS_PATH,
  controlError,
  DEFAULT_COMMAND_TIMEOUT_MS,
  findCommand,
  HELLO_TIMEOUT_MS,
  isValidClientId,
  MAX_COMMAND_TIMEOUT_MS,
  MAX_FRAME_BYTES,
  MAX_PENDING_PER_CONTROLLER,
  negotiateVersion,
  readBrowserState,
  SUPPORTED_PROTOCOL_VERSIONS,
  type TargetSummary,
  validateParams,
} from '@prompt-studio/control-protocol';
import { type RawData, type WebSocket, WebSocketServer } from 'ws';
import { validateOrigin, validateToken } from '../../src/bridge/fs-bridge';

/**
 * The Studio's remote-control GATEWAY over WebSocket (docs/remote-control.md; spec phase 1).
 *
 * One endpoint, `/__control/ws`, two roles: editor tabs connect as `browser` and execute commands; the CLI,
 * the MCP server and scripts connect as `controller` and send them. The gateway authenticates every
 * connection with the control token in its first message, validates each command against the catalog before
 * it routes it, picks the target tab, and relays the tab's result back to the one controller that asked.
 *
 * Security: the server is loopback-bound; a WebSocket upgrade whose `Origin` header is present and foreign is
 * refused with 403 (browsers always send Origin, the CLI sends none); a connection is unauthenticated until a
 * timely `hello` with a valid token. Logs carry ids, actions and error codes, never tokens or params.
 */

export interface GatewayLogEvent {
  readonly event: string;
  readonly [field: string]: unknown;
}

export interface ControlGatewayOptions {
  readonly token: string;
  readonly allowedOrigins: readonly string[];
  readonly helloTimeoutMs?: number;
  readonly maxFrameBytes?: number;
  readonly maxPending?: number;
  readonly defaultTimeoutMs?: number;
  /** Interval of liveness pings; a socket that misses one pong is terminated. 0 disables. */
  readonly heartbeatMs?: number;
  /** Receives anomalies (rejected handshakes, ignored results). Defaults to `console.warn`. */
  readonly log?: (entry: GatewayLogEvent) => void;
}

/** What `dispatch` (the legacy HTTP route) gets back: the same terminal result a controller would. */
export type DispatchResult = Omit<CommandResultMessage, 'type' | 'requestId'>;

interface Connection {
  readonly socket: WebSocket;
  role: 'pending' | 'browser' | 'controller';
  alive: boolean;
  helloTimer: ReturnType<typeof setTimeout> | null;
  /** Controller only: commandIds it has in flight. */
  readonly pending: Set<string>;
  /** Browser only. */
  browserId?: string;
}

interface BrowserEntry {
  readonly browserId: string;
  readonly connection: Connection;
  readonly connectedAt: string;
  state: BrowserState;
}

interface InFlight {
  readonly commandId: string;
  readonly action: string;
  readonly browserId: string;
  readonly controller: Connection | null;
  readonly timer: ReturnType<typeof setTimeout>;
  readonly finish: (result: DispatchResult) => void;
}

const INITIAL_STATE: BrowserState = { ready: false, projectId: null, projectName: null, documentId: null, view: null };

function defaultLog(entry: GatewayLogEvent): void {
  console.warn('[prompt-studio control]', JSON.stringify(entry));
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

type TargetResolution = { readonly browser: BrowserEntry } | { readonly error: ControlError };

export class ControlGateway {
  private readonly wss: WebSocketServer;
  private readonly connections = new Set<Connection>();
  private readonly browsers = new Map<string, BrowserEntry>();
  private readonly inflight = new Map<string, InFlight>();
  private readonly heartbeat: ReturnType<typeof setInterval> | null;
  private readonly helloTimeoutMs: number;
  private readonly maxFrameBytes: number;
  private readonly maxPending: number;
  private readonly defaultTimeoutMs: number;
  private readonly log: (entry: GatewayLogEvent) => void;
  private closed = false;

  constructor(private readonly options: ControlGatewayOptions) {
    this.helloTimeoutMs = options.helloTimeoutMs ?? HELLO_TIMEOUT_MS;
    this.maxFrameBytes = options.maxFrameBytes ?? MAX_FRAME_BYTES;
    this.maxPending = options.maxPending ?? MAX_PENDING_PER_CONTROLLER;
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    this.log = options.log ?? defaultLog;
    // `maxPayload` makes ws close an oversized frame's connection with 1009 before it is buffered whole.
    this.wss = new WebSocketServer({ noServer: true, maxPayload: this.maxFrameBytes });
    const heartbeatMs = options.heartbeatMs ?? 30_000;
    this.heartbeat = heartbeatMs > 0 ? setInterval(() => this.pingAll(), heartbeatMs) : null;
    this.heartbeat?.unref?.();
  }

  /** Handles `upgrade` requests for `/__control/ws`; returns false (socket untouched) for any other path. */
  handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname !== CONTROL_WS_PATH) return false;
    if (this.closed) {
      socket.end('HTTP/1.1 503 Service Unavailable\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return true;
    }
    if (!validateOrigin(headerValue(req.headers.origin), this.options.allowedOrigins)) {
      this.log({ event: 'upgrade.rejected', reason: 'origin' });
      socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\nContent-Length: 0\r\n\r\n');
      return true;
    }
    this.wss.handleUpgrade(req, socket, head, (ws) => this.onConnection(ws));
    return true;
  }

  /** Adds an `upgrade` listener to an HTTP server. Other paths are left to other listeners (Vite HMR). */
  attach(server: Server, options: { readonly rejectOtherPaths?: boolean } = {}): void {
    server.on('upgrade', (req: IncomingMessage, socket: Duplex, head: Buffer) => {
      if (!this.handleUpgrade(req, socket, head) && options.rejectOtherPaths === true) socket.destroy();
    });
  }

  hasBrowsers(): boolean {
    return this.browsers.size > 0;
  }

  listTargets(): TargetSummary[] {
    return [...this.browsers.values()].map((entry) => this.summary(entry));
  }

  /**
   * Runs one command for a caller that is not a WebSocket controller (the deprecated `POST /__control/command`).
   * Same validation, target selection and timeout as a controller command.
   */
  dispatch(action: string, params: unknown, target?: { readonly browserId?: string }, timeoutMs?: number) {
    return new Promise<DispatchResult>((resolve) => {
      this.startCommand(
        null,
        { commandId: `http-${randomUUID()}`, action, params, target, timeoutMs },
        {
          accepted: () => {},
          finish: resolve,
        },
      );
    });
  }

  /** Fails every in-flight command, closes every socket and stops accepting connections. */
  close(): Promise<void> {
    this.closed = true;
    if (this.heartbeat !== null) clearInterval(this.heartbeat);
    for (const entry of [...this.inflight.values()]) {
      this.settle(entry, {
        commandId: entry.commandId,
        state: 'failed',
        error: controlError('disconnected', 'The Studio is shutting down.', { outcome: 'unknown' }),
      });
    }
    for (const connection of this.connections) connection.socket.close(1001, 'shutting down');
    return new Promise((resolve) => this.wss.close(() => resolve()));
  }

  // ── Connection lifecycle ─────────────────────────────────────────────────────────────────────

  private onConnection(socket: WebSocket): void {
    const connection: Connection = { socket, role: 'pending', alive: true, helloTimer: null, pending: new Set() };
    this.connections.add(connection);
    connection.helloTimer = setTimeout(() => {
      this.log({ event: 'hello.timeout' });
      socket.close(CLOSE_CODES.helloTimeout, 'hello timeout');
    }, this.helloTimeoutMs);
    socket.on('pong', () => {
      connection.alive = true;
    });
    socket.on('message', (data, isBinary) => this.onMessage(connection, data, isBinary));
    socket.on('close', () => this.onClose(connection));
    socket.on('error', (error) => {
      // ws reports an oversized frame here and then closes with 1009.
      this.log({ event: 'socket.error', role: connection.role, message: error.message });
    });
  }

  private onClose(connection: Connection): void {
    if (connection.helloTimer !== null) clearTimeout(connection.helloTimer);
    this.connections.delete(connection);
    if (connection.role === 'browser' && connection.browserId !== undefined) {
      const entry = this.browsers.get(connection.browserId);
      if (entry?.connection === connection) this.browsers.delete(connection.browserId);
      for (const command of [...this.inflight.values()]) {
        if (command.browserId === connection.browserId) {
          this.settle(command, {
            commandId: command.commandId,
            state: 'failed',
            target: { browserId: command.browserId },
            error: controlError('disconnected', 'The editor tab disconnected before it answered.', {
              outcome: 'unknown',
            }),
          });
        }
      }
    }
    // A controller's commands keep running in the tab; their results have no one to go to and are dropped.
  }

  private pingAll(): void {
    for (const connection of this.connections) {
      if (!connection.alive) {
        connection.socket.terminate();
        continue;
      }
      connection.alive = false;
      connection.socket.ping();
    }
  }

  private send(connection: Connection, message: Record<string, unknown>): void {
    if (connection.socket.readyState === connection.socket.OPEN) connection.socket.send(JSON.stringify(message));
  }

  private onMessage(connection: Connection, data: RawData, isBinary: boolean): void {
    let message: Record<string, unknown>;
    try {
      if (isBinary) throw new Error('binary');
      const parsed: unknown = JSON.parse(rawToString(data));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) throw new Error('not an object');
      message = parsed as Record<string, unknown>;
    } catch {
      if (connection.role === 'pending') {
        this.rejectHello(connection, CLOSE_CODES.invalidHello, 'invalid_input', 'The first message must be hello.');
        return;
      }
      this.send(connection, { type: 'error', error: controlError('invalid_input', 'Frames must be JSON objects.') });
      return;
    }
    if (connection.role === 'pending') this.onHello(connection, message);
    else if (connection.role === 'browser') this.onBrowserMessage(connection, message);
    else this.onControllerMessage(connection, message);
  }

  private rejectHello(connection: Connection, closeCode: number, code: ControlError['code'], message: string): void {
    this.log({ event: 'hello.rejected', code });
    // `unauthorized` gets no error frame: an unauthenticated peer learns nothing beyond the close code.
    if (code !== 'unauthorized') this.send(connection, { type: 'error', error: controlError(code, message) });
    connection.socket.close(closeCode, code);
  }

  private onHello(connection: Connection, message: Record<string, unknown>): void {
    if (message.type !== 'hello') {
      this.rejectHello(connection, CLOSE_CODES.invalidHello, 'invalid_input', 'The first message must be hello.');
      return;
    }
    if (!validateToken(typeof message.token === 'string' ? message.token : null, this.options.token)) {
      this.rejectHello(connection, CLOSE_CODES.unauthorized, 'unauthorized', 'Invalid control token.');
      return;
    }
    const version = negotiateVersion(message.protocolVersions);
    if (version === null) {
      this.rejectHello(
        connection,
        CLOSE_CODES.unsupportedVersion,
        'unsupported_version',
        `No common protocol version; this Studio speaks ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}.`,
      );
      return;
    }
    if (message.role !== 'browser' && message.role !== 'controller') {
      this.rejectHello(connection, CLOSE_CODES.invalidHello, 'invalid_input', 'role must be browser or controller.');
      return;
    }
    if (connection.helloTimer !== null) clearTimeout(connection.helloTimer);
    connection.helloTimer = null;
    connection.role = message.role;
    const limits = {
      maxFrameBytes: this.maxFrameBytes,
      maxPending: this.maxPending,
      maxTimeoutMs: MAX_COMMAND_TIMEOUT_MS,
    };
    if (message.role === 'controller') {
      this.send(connection, {
        type: 'welcome',
        protocolVersion: version,
        role: 'controller',
        commands: COMMAND_CATALOG,
        limits,
      });
      return;
    }
    const requested = message.resumeBrowserId;
    // Keep the id across a reload of the same tab, but never take it from a live socket (spec RC-04).
    const browserId = isValidClientId(requested) && !this.browsers.has(requested) ? requested : `tab-${randomUUID()}`;
    connection.browserId = browserId;
    this.browsers.set(browserId, {
      browserId,
      connection,
      connectedAt: new Date().toISOString(),
      state: readBrowserState(message.state) ?? INITIAL_STATE,
    });
    this.send(connection, {
      type: 'welcome',
      protocolVersion: version,
      role: 'browser',
      browserId,
      commands: COMMAND_CATALOG,
      limits,
    });
  }

  private onBrowserMessage(connection: Connection, message: Record<string, unknown>): void {
    const browserId = connection.browserId as string;
    if (message.type === 'state.update') {
      const state = readBrowserState(message.state);
      const entry = this.browsers.get(browserId);
      if (state !== null && entry?.connection === connection) entry.state = state;
      return;
    }
    if (message.type === 'command.result') {
      const commandId = typeof message.commandId === 'string' ? message.commandId : '';
      const command = this.inflight.get(commandId);
      if (command === undefined) {
        // Late (after a timeout) or unknown: nothing waits for it.
        this.log({ event: 'result.ignored', reason: 'unknown_command', browserId });
        return;
      }
      if (command.browserId !== browserId) {
        // Spec RC-37: only the tab the command was routed to may answer it.
        this.log({ event: 'result.ignored', reason: 'wrong_browser', browserId, commandId });
        return;
      }
      const ok = message.ok === true;
      this.settle(
        command,
        ok
          ? {
              commandId,
              state: 'completed',
              completionLevel: 'applied',
              target: { browserId },
              data: message.data ?? null,
            }
          : {
              commandId,
              state: 'failed',
              target: { browserId },
              error: controlError(
                'command_failed',
                typeof message.error === 'string' && message.error.length > 0 ? message.error : 'The command failed.',
                { outcome: 'none' },
              ),
            },
      );
      return;
    }
    this.send(connection, { type: 'error', error: controlError('invalid_input', 'Unknown message type.') });
  }

  private onControllerMessage(connection: Connection, message: Record<string, unknown>): void {
    const requestId = typeof message.requestId === 'string' ? message.requestId : undefined;
    if (message.type === 'targets.list') {
      this.send(connection, { type: 'targets', requestId, targets: this.listTargets() });
      return;
    }
    if (message.type === 'command') {
      if (requestId === undefined) {
        this.send(connection, { type: 'error', error: controlError('invalid_input', 'command needs a requestId.') });
        return;
      }
      const commandId = message.commandId;
      if (!isValidClientId(commandId)) {
        this.send(connection, {
          type: 'command.result',
          requestId,
          commandId: typeof commandId === 'string' ? commandId : '',
          state: 'failed',
          error: controlError('invalid_input', 'commandId must be 1–128 letters, digits or _.:-', { outcome: 'none' }),
        });
        return;
      }
      const target = message.target as { browserId?: unknown } | undefined;
      this.startCommand(
        connection,
        {
          commandId,
          action: message.action,
          params: message.params,
          target: target === undefined ? undefined : target,
          waitFor: message.waitFor,
          timeoutMs: message.timeoutMs,
        },
        {
          accepted: (browserId) =>
            this.send(connection, { type: 'command.accepted', requestId, commandId, target: { browserId } }),
          finish: (result) => this.send(connection, { type: 'command.result', requestId, ...result }),
        },
      );
      return;
    }
    this.send(connection, { type: 'error', requestId, error: controlError('invalid_input', 'Unknown message type.') });
  }

  // ── Commands ─────────────────────────────────────────────────────────────────────────────────

  private startCommand(
    controller: Connection | null,
    request: {
      readonly commandId: string;
      readonly action: unknown;
      readonly params: unknown;
      readonly target?: { readonly browserId?: unknown };
      readonly waitFor?: unknown;
      readonly timeoutMs?: unknown;
    },
    reply: { readonly accepted: (browserId: string) => void; readonly finish: (result: DispatchResult) => void },
  ): void {
    const { commandId } = request;
    const reject = (error: ControlError) =>
      reply.finish({ commandId, state: 'failed', error: { outcome: 'none', ...error } });

    // Validate everything BEFORE routing (spec RC-06): a rejected command never reaches a tab.
    const descriptor = typeof request.action === 'string' ? findCommand(request.action) : undefined;
    if (descriptor === undefined) {
      reject(controlError('unsupported_command', `Unknown command "${String(request.action)}". See capabilities.`));
      return;
    }
    if (request.waitFor !== undefined && request.waitFor !== 'applied') {
      reject(
        controlError('unsupported_completion', `${descriptor.name} supports waitFor "applied" only in this version.`),
      );
      return;
    }
    const paramsError = validateParams(descriptor, request.params);
    if (paramsError !== null) {
      reject(controlError('invalid_input', paramsError));
      return;
    }
    const timeoutMs = request.timeoutMs ?? this.defaultTimeoutMs;
    if (
      typeof timeoutMs !== 'number' ||
      !Number.isInteger(timeoutMs) ||
      timeoutMs < 1 ||
      timeoutMs > MAX_COMMAND_TIMEOUT_MS
    ) {
      reject(controlError('invalid_input', `timeoutMs must be an integer from 1 to ${MAX_COMMAND_TIMEOUT_MS}.`));
      return;
    }
    if (this.inflight.has(commandId)) {
      reject(controlError('duplicate_command', `Command ${commandId} is already running.`));
      return;
    }
    if (controller !== null && controller.pending.size >= this.maxPending) {
      reject(controlError('too_many_pending', `At most ${this.maxPending} commands may run at once per connection.`));
      return;
    }
    const resolution = this.resolveTarget(request.target?.browserId);
    if ('error' in resolution) {
      reject(resolution.error);
      return;
    }
    const { browser } = resolution;

    const timer = setTimeout(() => {
      const entry = this.inflight.get(commandId);
      if (entry === undefined) return;
      this.log({ event: 'command.timeout', commandId, action: descriptor.name, browserId: browser.browserId });
      this.settle(entry, {
        commandId,
        state: 'failed',
        target: { browserId: browser.browserId },
        error: controlError('timeout', `The editor tab did not answer ${descriptor.name} within ${timeoutMs} ms.`, {
          outcome: 'unknown',
        }),
      });
    }, timeoutMs);
    this.inflight.set(commandId, {
      commandId,
      action: descriptor.name,
      browserId: browser.browserId,
      controller,
      timer,
      finish: reply.finish,
    });
    controller?.pending.add(commandId);
    reply.accepted(browser.browserId);
    this.send(browser.connection, {
      type: 'command',
      commandId,
      action: descriptor.name,
      ...(request.params === undefined ? {} : { params: request.params }),
    });
  }

  private settle(entry: InFlight, result: DispatchResult): void {
    if (this.inflight.get(entry.commandId) !== entry) return;
    clearTimeout(entry.timer);
    this.inflight.delete(entry.commandId);
    entry.controller?.pending.delete(entry.commandId);
    entry.finish(result);
  }

  private resolveTarget(browserId: unknown): TargetResolution {
    if (browserId !== undefined) {
      const entry = typeof browserId === 'string' ? this.browsers.get(browserId) : undefined;
      if (entry === undefined) {
        return {
          error: controlError('missing_target', `No editor tab "${String(browserId)}". Run targets to list tabs.`),
        };
      }
      if (!entry.state.ready) {
        return {
          error: controlError('not_ready', `Editor tab ${entry.browserId} is still loading. Try again shortly.`),
        };
      }
      return { browser: entry };
    }
    const ready = [...this.browsers.values()].filter((entry) => entry.state.ready);
    if (ready.length === 1) return { browser: ready[0] as BrowserEntry };
    if (ready.length > 1) {
      return {
        error: controlError('ambiguous_target', `${ready.length} editor tabs are open. Choose one with a browserId.`, {
          candidates: ready.map((entry) => this.summary(entry)),
        }),
      };
    }
    return {
      error: controlError(
        'not_ready',
        this.browsers.size === 0
          ? 'No editor tab is connected — open Prompt Studio in a browser first.'
          : 'The open editor tab is still loading. Try again shortly.',
      ),
    };
  }

  private summary(entry: BrowserEntry): TargetSummary {
    return { browserId: entry.browserId, connectedAt: entry.connectedAt, ...entry.state };
  }
}
