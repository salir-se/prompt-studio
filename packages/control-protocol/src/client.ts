import {
  type CommandDescriptor,
  type CommandResultMessage,
  type CommandTarget,
  type CompletionLevel,
  type ControlError,
  controlError,
  DEFAULT_COMMAND_TIMEOUT_MS,
  type ErrorMessage,
  SUPPORTED_PROTOCOL_VERSIONS,
  type TargetSummary,
  type WelcomeMessage,
} from './protocol';

/**
 * A controller connection (CLI, MCP server, scripts) to the Studio gateway. Uses the platform `WebSocket`
 * (browsers, Bun, Node 22+). One connection carries many commands; each is correlated by `requestId`.
 */

export class ControlConnectionError extends Error {
  constructor(readonly error: ControlError) {
    super(error.message);
  }
}

export interface ControlClientOptions {
  /** e.g. `ws://127.0.0.1:5273/__control/ws`. */
  readonly url: string;
  readonly token: string;
  /** How long to wait for the connection and `welcome`. */
  readonly connectTimeoutMs?: number;
  /** Injectable for tests. */
  readonly WebSocketImpl?: typeof WebSocket;
}

export interface CommandOptions {
  readonly action: string;
  readonly params?: unknown;
  readonly target?: CommandTarget;
  /** Stable id of the logical operation; generated when omitted. */
  readonly commandId?: string;
  readonly waitFor?: CompletionLevel;
  readonly timeoutMs?: number;
}

type Waiter = (message: Record<string, unknown>) => void;

function randomId(prefix: string): string {
  return `${prefix}-${globalThis.crypto.randomUUID()}`;
}

export class ControlClient {
  private readonly waiters = new Map<string, Waiter>();
  private closedError: ControlError | null = null;

  private constructor(
    private readonly socket: WebSocket,
    readonly welcome: WelcomeMessage,
  ) {
    socket.addEventListener('message', (event) => this.onMessage(event.data));
    socket.addEventListener('close', () => this.failAll(controlError('disconnected', 'The Studio connection closed.')));
  }

  get commands(): readonly CommandDescriptor[] {
    return this.welcome.commands;
  }

  static connect(options: ControlClientOptions): Promise<ControlClient> {
    const Impl = options.WebSocketImpl ?? globalThis.WebSocket;
    if (Impl === undefined) {
      return Promise.reject(
        new ControlConnectionError(controlError('internal', 'This runtime has no WebSocket; use Node 22+ or Bun.')),
      );
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new Impl(options.url);
      const fail = (error: ControlError) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        try {
          socket.close();
        } catch {
          // already closed
        }
        reject(new ControlConnectionError(error));
      };
      const timer = setTimeout(
        () => fail(controlError('timeout', 'The Studio did not answer the connection request.', { outcome: 'none' })),
        options.connectTimeoutMs ?? 10_000,
      );
      socket.addEventListener('open', () => {
        socket.send(
          JSON.stringify({
            type: 'hello',
            protocolVersions: SUPPORTED_PROTOCOL_VERSIONS,
            role: 'controller',
            token: options.token,
          }),
        );
      });
      socket.addEventListener('error', () =>
        fail(controlError('disconnected', `Cannot reach the Studio at ${options.url}. Is it running?`, { outcome: 'none' })),
      );
      socket.addEventListener('close', (event) => {
        if (event.code === 4401) fail(controlError('unauthorized', 'The Studio rejected the control token.'));
        else if (event.code === 4403) fail(controlError('forbidden', 'The Studio refused this connection.'));
        else if (event.code === 4426) fail(controlError('unsupported_version', 'No common protocol version.'));
        else fail(controlError('disconnected', 'The Studio closed the connection.', { outcome: 'none' }));
      });
      const onFirst = (event: MessageEvent) => {
        socket.removeEventListener('message', onFirst);
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          fail(controlError('internal', 'The Studio sent an unreadable handshake.'));
          return;
        }
        if (message.type === 'error') {
          fail((message as unknown as ErrorMessage).error);
          return;
        }
        if (message.type !== 'welcome') {
          fail(controlError('internal', 'The Studio sent an unexpected handshake.'));
          return;
        }
        settled = true;
        clearTimeout(timer);
        resolve(new ControlClient(socket, message as unknown as WelcomeMessage));
      };
      socket.addEventListener('message', onFirst);
    });
  }

  /** Lists accessible editor tabs (spec RC-04). */
  listTargets(timeoutMs = 10_000): Promise<readonly TargetSummary[]> {
    const requestId = randomId('req');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.waiters.delete(requestId);
        reject(new ControlConnectionError(controlError('timeout', 'No target list from the Studio.', { outcome: 'none' })));
      }, timeoutMs);
      this.waiters.set(requestId, (message) => {
        clearTimeout(timer);
        if (message.type === 'targets') resolve(message.targets as TargetSummary[]);
        else reject(new ControlConnectionError((message as unknown as ErrorMessage).error));
      });
      this.send({ type: 'targets.list', requestId }, requestId);
    });
  }

  /**
   * Sends one command and resolves with its terminal result. Transport failures resolve as a failed result
   * whose error says whether the command may have run (`outcome: 'unknown'`); this never rejects.
   */
  command(options: CommandOptions): Promise<CommandResultMessage> {
    const requestId = randomId('req');
    const commandId = options.commandId ?? randomId('cmd');
    const timeoutMs = options.timeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS;
    return new Promise((resolve) => {
      const finish = (result: CommandResultMessage) => {
        clearTimeout(timer);
        this.waiters.delete(requestId);
        resolve(result);
      };
      // The gateway enforces timeoutMs; this local bound only covers a gateway that never answers.
      const timer = setTimeout(
        () =>
          finish({
            type: 'command.result',
            requestId,
            commandId,
            state: 'failed',
            error: controlError('timeout', `No result for ${options.action} within ${timeoutMs} ms.`, {
              outcome: 'unknown',
            }),
          }),
        timeoutMs + 5_000,
      );
      this.waiters.set(requestId, (message) => {
        if (message.type === 'command.accepted') return; // keep waiting for the terminal result
        if (message.type === 'command.result') finish(message as unknown as CommandResultMessage);
        else
          finish({
            type: 'command.result',
            requestId,
            commandId,
            state: 'failed',
            error: (message as unknown as ErrorMessage).error,
          });
      });
      this.send(
        {
          type: 'command',
          requestId,
          commandId,
          action: options.action,
          ...(options.params === undefined ? {} : { params: options.params }),
          ...(options.target === undefined ? {} : { target: options.target }),
          ...(options.waitFor === undefined ? {} : { waitFor: options.waitFor }),
          timeoutMs,
        },
        requestId,
      );
    });
  }

  close(): void {
    this.socket.close(1000);
  }

  private send(message: Record<string, unknown>, requestId: string): void {
    if (this.closedError) {
      this.waiters.get(requestId)?.({ type: 'error', error: this.closedError });
      return;
    }
    this.socket.send(JSON.stringify(message));
  }

  private onMessage(data: unknown): void {
    let message: Record<string, unknown>;
    try {
      message = JSON.parse(String(data));
    } catch {
      return;
    }
    const requestId = typeof message.requestId === 'string' ? message.requestId : undefined;
    if (requestId !== undefined) this.waiters.get(requestId)?.(message);
  }

  private failAll(error: ControlError): void {
    this.closedError = { ...error, outcome: 'unknown' };
    for (const waiter of [...this.waiters.values()]) waiter({ type: 'error', error: this.closedError });
    this.waiters.clear();
  }
}

/** Resolves the WebSocket URL for a Studio on this computer. */
export function localControlUrl(port: number, host = '127.0.0.1'): string {
  return `ws://${host}:${port}/__control/ws`;
}
