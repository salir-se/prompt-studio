import {
  CLOSE_CODES,
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
} from './protocol.ts';

/**
 * A controller connection (CLI, MCP server, scripts) to the Studio gateway. Uses the platform `WebSocket`
 * (Bun and browsers; Bun is the supported runtime). One connection carries many commands; each is correlated by `requestId`.
 */

export class ControlConnectionError extends Error {
  readonly error: ControlError;
  constructor(error: ControlError) {
    super(error.message);
    this.error = error;
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
  /** Versions offered in `hello`; tests override it to check negotiation. */
  readonly protocolVersions?: readonly string[];
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

/** Maps a close code received during the handshake to the error a caller sees. */
function handshakeCloseError(code: number, url: string): ControlError {
  switch (code) {
    case CLOSE_CODES.unauthorized:
      return controlError('unauthorized', 'The Studio rejected the control token.', { outcome: 'none' });
    case CLOSE_CODES.forbidden:
      return controlError('forbidden', 'The Studio refused this connection.', { outcome: 'none' });
    case CLOSE_CODES.unsupportedVersion:
      return controlError('unsupported_version', 'The Studio and this client share no protocol version.', {
        outcome: 'none',
      });
    case 1006:
      return controlError('disconnected', `Cannot reach the Studio at ${url}. Is it running?`, { outcome: 'none' });
    default:
      return controlError('disconnected', `The Studio closed the connection (code ${code}).`, { outcome: 'none' });
  }
}

export class ControlClient {
  private readonly waiters = new Map<string, Waiter>();
  private readonly closeListeners = new Set<(error: ControlError) => void>();
  private closedError: ControlError | null = null;

  private readonly socket: WebSocket;
  readonly welcome: WelcomeMessage;

  // No parameter properties: this package stays erasable TypeScript (the Vite config loads it untranspiled).
  private constructor(socket: WebSocket, welcome: WelcomeMessage) {
    this.socket = socket;
    this.welcome = welcome;
    socket.addEventListener('message', (event) => this.onMessage(event.data));
    socket.addEventListener('close', (event) =>
      this.failAll(
        event.code === 1009
          ? controlError('payload_too_large', 'The Studio closed the connection: a frame was too large.')
          : controlError('disconnected', 'The Studio connection closed.'),
      ),
    );
  }

  get commands(): readonly CommandDescriptor[] {
    return this.welcome.commands;
  }

  /** False once the connection has closed; a closed client fails every call. */
  get isOpen(): boolean {
    return this.closedError === null;
  }

  /** Called once when the connection closes. Returns an unsubscribe function. */
  onClose(listener: (error: ControlError) => void): () => void {
    this.closeListeners.add(listener);
    return () => this.closeListeners.delete(listener);
  }

  static connect(options: ControlClientOptions): Promise<ControlClient> {
    const Impl = options.WebSocketImpl ?? globalThis.WebSocket;
    if (Impl === undefined) {
      return Promise.reject(
        new ControlConnectionError(controlError('internal', 'This runtime has no WebSocket; run it with Bun.')),
      );
    }
    return new Promise((resolve, reject) => {
      let settled = false;
      let socket: WebSocket;
      try {
        socket = new Impl(options.url);
      } catch {
        reject(
          new ControlConnectionError(
            controlError('invalid_input', `Not a WebSocket URL: ${options.url}`, { outcome: 'none' }),
          ),
        );
        return;
      }
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
            protocolVersions: options.protocolVersions ?? SUPPORTED_PROTOCOL_VERSIONS,
            role: 'controller',
            token: options.token,
          }),
        );
      });
      // A refused connection fires `error` and then `close` (1006); the close code carries the reason.
      socket.addEventListener('close', (event) => fail(handshakeCloseError(event.code, options.url)));
      const onFirst = (event: MessageEvent) => {
        let message: Record<string, unknown>;
        try {
          message = JSON.parse(String(event.data));
        } catch {
          fail(controlError('internal', 'The Studio sent an unreadable handshake.'));
          return;
        }
        // The gateway sends an `error` frame before it closes with 4426 / 4400; report that error.
        if (message.type === 'error') {
          fail({ outcome: 'none', ...(message as unknown as ErrorMessage).error });
          return;
        }
        socket.removeEventListener('message', onFirst);
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
        reject(
          new ControlConnectionError(controlError('timeout', 'No target list from the Studio.', { outcome: 'none' })),
        );
      }, timeoutMs);
      this.waiters.set(requestId, (message) => {
        clearTimeout(timer);
        this.waiters.delete(requestId);
        if (message.type === 'targets') resolve(message.targets as TargetSummary[]);
        else reject(new ControlConnectionError((message as unknown as ErrorMessage).error));
      });
      this.sendRaw(JSON.stringify({ type: 'targets.list', requestId }), requestId);
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
    const failed = (error: ControlError): CommandResultMessage => ({
      type: 'command.result',
      requestId,
      commandId,
      state: 'failed',
      error,
    });
    const frame = JSON.stringify({
      type: 'command',
      requestId,
      commandId,
      action: options.action,
      ...(options.params === undefined ? {} : { params: options.params }),
      ...(options.target === undefined ? {} : { target: options.target }),
      ...(options.waitFor === undefined ? {} : { waitFor: options.waitFor }),
      timeoutMs,
    });
    // Refuse locally what the gateway would refuse by closing the connection (1009): nothing was sent.
    const frameBytes = new TextEncoder().encode(frame).byteLength;
    if (frameBytes > this.welcome.limits.maxFrameBytes) {
      return Promise.resolve(
        failed(
          controlError(
            'payload_too_large',
            `The command is ${frameBytes} bytes; the Studio accepts at most ${this.welcome.limits.maxFrameBytes}.`,
            { outcome: 'none' },
          ),
        ),
      );
    }
    return new Promise((resolve) => {
      const finish = (result: CommandResultMessage) => {
        clearTimeout(timer);
        this.waiters.delete(requestId);
        resolve(result);
      };
      // The gateway enforces timeoutMs; this local bound only covers a gateway that never answers.
      const timer = setTimeout(
        () =>
          finish(
            failed(
              controlError('timeout', `No result for ${options.action} within ${timeoutMs} ms.`, {
                outcome: 'unknown',
              }),
            ),
          ),
        timeoutMs + 5_000,
      );
      this.waiters.set(requestId, (message) => {
        if (message.type === 'command.accepted' || message.type === 'command.progress') return;
        if (message.type === 'command.result') finish(message as unknown as CommandResultMessage);
        else finish(failed((message as unknown as ErrorMessage).error));
      });
      this.sendRaw(frame, requestId);
    });
  }

  close(): void {
    try {
      this.socket.close(1000);
    } catch {
      // already closed
    }
  }

  private sendRaw(frame: string, requestId: string): void {
    if (this.closedError !== null) {
      this.waiters.get(requestId)?.({ type: 'error', error: { ...this.closedError, outcome: 'none' } });
      return;
    }
    try {
      this.socket.send(frame);
    } catch {
      this.waiters.get(requestId)?.({
        type: 'error',
        error: controlError('disconnected', 'The Studio connection is not open.', { outcome: 'none' }),
      });
    }
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
    if (this.closedError !== null) return;
    this.closedError = { ...error, outcome: 'unknown' };
    for (const waiter of [...this.waiters.values()]) waiter({ type: 'error', error: this.closedError });
    this.waiters.clear();
    for (const listener of [...this.closeListeners]) listener(this.closedError);
    this.closeListeners.clear();
  }
}

/** Resolves the WebSocket URL for a Studio on this computer. */
export function localControlUrl(port: number, host = '127.0.0.1'): string {
  return `ws://${host}:${port}/__control/ws`;
}
