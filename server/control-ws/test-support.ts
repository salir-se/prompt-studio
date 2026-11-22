import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  type BrowserState,
  ControlCommandError,
  localControlUrl,
  PROTOCOL_VERSION,
  type WelcomeMessage,
} from '@prompt-studio/control-protocol';
import WebSocket from 'ws';
import { ControlHub } from '../control-hub';
import { type ControlRoutes, type ControlRoutesOptions, createControlRoutes } from '../control-routes';
import type { GatewayLogEvent } from './gateway';

/**
 * Test support for the WebSocket gateway: a REAL Studio control server on an ephemeral loopback port (the same
 * `createControlRoutes` + `attachUpgrade` the standalone server uses) and a fake editor tab that is a real
 * WebSocket client speaking the browser role. Nothing here replaces gateway code.
 */

export const TEST_TOKEN = 'nonfunctional-control-fixture-token';
export const TEST_ORIGIN = 'http://127.0.0.1:5273';

export interface StudioFixture {
  readonly port: number;
  readonly url: string;
  readonly routes: ControlRoutes;
  readonly hub: ControlHub;
  readonly server: Server;
  readonly logs: GatewayLogEvent[];
  close(): Promise<void>;
}

export async function startStudioFixture(
  gateway: ControlRoutesOptions['gateway'] = {},
  token: string = TEST_TOKEN,
): Promise<StudioFixture> {
  const logs: GatewayLogEvent[] = [];
  const hub = new ControlHub();
  const routes = await createControlRoutes(
    hub,
    token,
    async () => {},
    async () => {},
    {
      tokenDir: '/nonfunctional-fixture',
      port: 0,
      allowedOrigins: [TEST_ORIGIN],
      gateway: { heartbeatMs: 0, log: (entry) => logs.push(entry), ...gateway },
    },
  );
  const server = createServer((req, res) => {
    void routes.handle(req, res).then((handled) => {
      if (!handled) res.writeHead(404).end();
    });
  });
  routes.attachUpgrade(server, { rejectOtherPaths: true });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  return {
    port,
    url: localControlUrl(port),
    routes,
    hub,
    server,
    logs,
    async close() {
      await routes.dispose();
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

export const READY_STATE: BrowserState = {
  ready: true,
  projectId: 'default',
  projectName: 'Default',
  documentId: null,
  view: null,
};

export type FakeHandler = (action: string, params: unknown) => unknown | Promise<unknown>;

export interface ReceivedCommand {
  readonly commandId: string;
  readonly action: string;
  readonly params: unknown;
}

/** A fake editor tab: a real WebSocket client in the browser role that answers commands with `handler`. */
export class FakeBrowser {
  readonly received: ReceivedCommand[] = [];
  /** When false, commands are recorded but never answered (to test timeouts and disconnects). */
  answer = true;
  private constructor(
    readonly socket: WebSocket,
    readonly welcome: WelcomeMessage,
    private handler: FakeHandler,
  ) {
    socket.on('message', (data) => {
      const message = JSON.parse(String(data)) as Record<string, unknown>;
      if (message.type !== 'command') return;
      const command = {
        commandId: message.commandId as string,
        action: message.action as string,
        params: message.params,
      };
      this.received.push(command);
      if (!this.answer) return;
      void Promise.resolve()
        .then(() => this.handler(command.action, command.params))
        .then(
          (data) => this.send({ type: 'command.result', commandId: command.commandId, ok: true, data }),
          (error: unknown) =>
            this.send({
              type: 'command.result',
              commandId: command.commandId,
              ok: false,
              error: error instanceof Error ? error.message : String(error),
              // Like the real tab (ws-control-channel.ts): a ControlCommandError carries its stable code.
              ...(error instanceof ControlCommandError ? { code: error.code } : {}),
            }),
        );
    });
  }

  get browserId(): string {
    return this.welcome.browserId as string;
  }

  static async connect(
    url: string,
    options: {
      readonly token?: string;
      readonly state?: BrowserState;
      readonly resumeBrowserId?: string;
      readonly handler?: FakeHandler;
    } = {},
  ): Promise<FakeBrowser> {
    const socket = new WebSocket(url);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', () => resolve());
      socket.once('error', reject);
    });
    const welcome = await new Promise<WelcomeMessage>((resolve, reject) => {
      socket.once('message', (data) => {
        const message = JSON.parse(String(data)) as WelcomeMessage;
        if (message.type === 'welcome') resolve(message);
        else reject(new Error(`expected welcome, got ${String(data)}`));
      });
      socket.once('close', (code) => reject(new Error(`closed ${code}`)));
      socket.send(
        JSON.stringify({
          type: 'hello',
          role: 'browser',
          protocolVersions: [PROTOCOL_VERSION],
          token: options.token ?? TEST_TOKEN,
          state: options.state ?? READY_STATE,
          ...(options.resumeBrowserId === undefined ? {} : { resumeBrowserId: options.resumeBrowserId }),
        }),
      );
    });
    return new FakeBrowser(socket, welcome, options.handler ?? ((action) => ({ ran: action })));
  }

  send(message: Record<string, unknown>): void {
    this.socket.send(JSON.stringify(message));
  }

  setHandler(handler: FakeHandler): void {
    this.handler = handler;
  }

  /** Resolves once the tab has received `count` commands. */
  async waitForCommands(count: number): Promise<void> {
    while (this.received.length < count) await new Promise((resolve) => setTimeout(resolve, 5));
  }

  async close(): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    const closed = new Promise<void>((resolve) => this.socket.once('close', () => resolve()));
    this.socket.close();
    await closed;
  }
}

/** Opens a raw WebSocket and resolves with how it ended: the HTTP status of a refused upgrade, or a close code. */
export function rawConnect(
  url: string,
  options: { readonly origin?: string; readonly firstMessage?: unknown } = {},
): Promise<{ status?: number; closeCode?: number; messages: unknown[] }> {
  return new Promise((resolve) => {
    const socket = new WebSocket(url, options.origin === undefined ? {} : { origin: options.origin });
    const messages: unknown[] = [];
    socket.on('unexpected-response', (_req, res) => {
      resolve({ status: res.statusCode, messages });
      socket.terminate();
    });
    socket.on('error', () => {});
    socket.on('open', () => {
      if (options.firstMessage !== undefined) socket.send(JSON.stringify(options.firstMessage));
    });
    socket.on('message', (data) => messages.push(JSON.parse(String(data))));
    socket.on('close', (code) => resolve({ closeCode: code, messages }));
  });
}
