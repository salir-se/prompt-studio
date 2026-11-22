/**
 * The MCP server's connection to Prompt Studio (task #20; docs/remote-control.md): ONE lazy WebSocket
 * controller connection to the Studio gateway (`/__control/ws`), shared by every tool call and opened again
 * after it drops. The CLI uses the same `ControlClient` from `@prompt-studio/control-protocol`, so both
 * speak exactly one protocol. Config from the environment, the way MCP clients pass server config:
 *
 *   PROMPT_STUDIO_PORT           studio port (default 5273)
 *   PROMPT_STUDIO_CONTROL_TOKEN  the control token — for docker-hosted studios the value pinned
 *                                at `docker run -e STUDIO_CONTROL_TOKEN=…`; for a local dev
 *                                studio, the per-boot token file is read instead
 */

import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  ControlClient,
  type ControlClientOptions,
  type ControlError,
  localControlUrl,
  type TargetSummary,
} from '@prompt-studio/control-protocol';

export function studioPort(): number {
  const parsed = Number(process.env.PROMPT_STUDIO_PORT ?? 5273);
  return Number.isInteger(parsed) && parsed > 0 && parsed < 65536 ? parsed : 5273;
}

async function readTokenFile(port: string | number): Promise<string> {
  return (await readFile(path.join(tmpdir(), `prompt-studio-control-${port}.token`), 'utf8')).trim();
}

export interface CallContext {
  readonly port: number;
  readonly token: string;
  /** How long to wait for the Studio to accept a connection; the client's default when omitted. */
  readonly connectTimeoutMs?: number;
}

/** Resolves port + token once per server run (per the env/file rules in the module doc). */
export async function resolveContext(
  readFileImpl: (path: string) => Promise<string> = readTokenFile,
): Promise<CallContext> {
  const port = studioPort();
  const fromEnv = process.env.PROMPT_STUDIO_CONTROL_TOKEN;
  // Trim regardless of source — env vars and files can both carry trailing whitespace.
  const token = (fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : await readFileImpl(String(port))).trim();
  return { port, token };
}

/** What the tools need from the Studio. */
export interface StudioCaller {
  /** Runs one command in a tab; resolves its data or throws a readable Error. */
  call(action: string, params: unknown, browserId?: string): Promise<unknown>;
  listTargets(): Promise<readonly TargetSummary[]>;
  close(): void;
}

/** A failed command, with the stable protocol error behind the message. */
export class StudioCommandError extends Error {
  constructor(readonly error: ControlError) {
    super(describeError(error));
  }
}

function describeError(error: ControlError): string {
  const lines = [`${error.message} (${error.code})`];
  if (error.candidates !== undefined && error.candidates.length > 0) {
    lines.push('Pass browserId, one of:');
    for (const candidate of error.candidates) {
      lines.push(
        `- ${candidate.browserId}: ${candidate.projectName ?? '-'} / ${candidate.documentId ?? 'no document'}`,
      );
    }
  }
  if (error.outcome === 'unknown') lines.push('The command may have run; read the document before you retry.');
  return lines.join('\n');
}

export class StudioConnection implements StudioCaller {
  private client: Promise<ControlClient> | null = null;

  constructor(
    private readonly context: CallContext,
    private readonly connect: (options: ControlClientOptions) => Promise<ControlClient> = (options) =>
      ControlClient.connect(options),
  ) {}

  async call(action: string, params: unknown, browserId?: string): Promise<unknown> {
    const client = await this.open();
    const result = await client.command({
      action,
      params,
      ...(browserId === undefined ? {} : { target: { browserId } }),
    });
    if (result.state === 'completed') return result.data ?? null;
    throw new StudioCommandError(result.error ?? { code: 'internal', message: 'The Studio sent no error.' });
  }

  async listTargets(): Promise<readonly TargetSummary[]> {
    const client = await this.open();
    return client.listTargets();
  }

  close(): void {
    const pending = this.client;
    this.client = null;
    void pending?.then((client) => client.close()).catch(() => {});
  }

  /** The shared connection, opened on first use and again after it closed. */
  private async open(): Promise<ControlClient> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (this.client === null) {
        const connecting = this.connect({
          url: localControlUrl(this.context.port),
          token: this.context.token,
          ...(this.context.connectTimeoutMs === undefined ? {} : { connectTimeoutMs: this.context.connectTimeoutMs }),
        }).then((client) => {
          client.onClose(() => {
            if (this.client === connecting) this.client = null;
          });
          return client;
        });
        connecting.catch(() => {
          if (this.client === connecting) this.client = null;
        });
        this.client = connecting;
      }
      let client: ControlClient;
      try {
        client = await this.client;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Cannot reach the studio on port ${this.context.port} — is it running, with a tab open? (${reason})`,
          { cause: error },
        );
      }
      if (client.isOpen) return client;
      this.client = null;
    }
    throw new Error(`Cannot reach the studio on port ${this.context.port} — the connection keeps closing.`);
  }
}
