/**
 * The MCP server's control-API client (task #20; ADR-236): one thin RPC function over the
 * studio's `POST /__control/command` endpoint — the same endpoint and wire shape as the `ps` CLI
 * (`cli/client.ts` at the repository root). Deliberately duplicated rather than imported across
 * packages: the CLI lives inside the studio app package (browser-facing deps), this is a
 * standalone stdio binary — a ~40-line client each, with the wire contract pinned by tests on
 * both sides. Config from the environment, the way MCP clients pass server config:
 *
 *   PROMPT_STUDIO_PORT           studio port (default 5273)
 *   PROMPT_STUDIO_CONTROL_TOKEN  the control token — for docker-hosted studios the value pinned
 *                                at `docker run -e STUDIO_CONTROL_TOKEN=…`; for a local dev
 *                                studio, the per-boot token file is read instead
 */

import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const STUDIO_TOKEN_HEADER = 'x-studio-token';

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
  /** Injectable for tests. */
  readonly fetchImpl?: typeof fetch;
}

/** Resolves port + token once per server run (per the env/file rules in the module doc). */
export async function resolveContext(
  readFileImpl: (path: string) => Promise<string> = readTokenFile,
  fetchImpl?: typeof fetch,
): Promise<CallContext> {
  const port = studioPort();
  const fromEnv = process.env.PROMPT_STUDIO_CONTROL_TOKEN;
  // Trim regardless of source — env vars and files can both carry trailing whitespace.
  const token = (fromEnv !== undefined && fromEnv.length > 0 ? fromEnv : await readFileImpl(String(port))).trim();
  return { port, token, ...(fetchImpl !== undefined ? { fetchImpl } : {}) };
}

/** One RPC round trip; throws readable errors (never stacks) — they become MCP tool errors. */
export async function callCommand(context: CallContext, command: string, args?: unknown): Promise<unknown> {
  const doFetch = context.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`http://127.0.0.1:${context.port}/__control/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [STUDIO_TOKEN_HEADER]: context.token },
      body: JSON.stringify({ command, args: args ?? {} }),
    });
  } catch {
    throw new Error(`Cannot reach the studio on port ${context.port} — is it running, with a tab open?`);
  }
  const body = (await response.json().catch(() => null)) as { ok?: boolean; result?: unknown; error?: string } | null;
  if (body === null) throw new Error(`The studio answered HTTP ${response.status} with an unreadable body.`);
  if (response.status !== 200 || body.ok !== true) {
    throw new Error(body.error ?? `The studio rejected "${command}" (HTTP ${response.status}).`);
  }
  return body.result;
}
