import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

/**
 * The CLI's control-API client (task #19; ADR-236): the CLI is deliberately a THIN RPC FORMATTER
 * — it shapes a call to the studio's `POST /__control/command` endpoint and prints what comes
 * back; there is no editor logic here. The running studio (dev server or container server)
 * relays the command to the open editor tab.
 *
 * Authentication follows the ADR-236 token-file contract: the server publishes its per-boot
 * token to `<tmpdir>/prompt-studio-control-<port>.token` (0600); an explicit `--token` always
 * wins. Errors are readable and actionable — a refused connection or a missing token file names
 * the likely cause (studio not running), never a stack trace.
 */

const STUDIO_TOKEN_HEADER = 'x-studio-token';

/** Extracted so tests can pin the file-name contract shared with `server/control-routes.ts`. */
export function controlTokenFilePath(port: number): string {
  return path.join(tmpdir(), `prompt-studio-control-${port}.token`);
}

export async function discoverToken(
  port: number,
  explicit?: string,
  readFileImpl: (path: string) => Promise<string> = (p) => readFile(p, 'utf8'),
): Promise<string> {
  // Precedence: --token > PROMPT_STUDIO_CONTROL_TOKEN (the docker-hosted workflow — the
  // operator pins STUDIO_CONTROL_TOKEN at `docker run` and exports the same here) > token file.
  const fromEnv = process.env.PROMPT_STUDIO_CONTROL_TOKEN;
  if (explicit !== undefined && explicit.length > 0) return explicit;
  if (fromEnv !== undefined && fromEnv.length > 0) return fromEnv;
  try {
    return (await readFileImpl(controlTokenFilePath(port))).trim();
  } catch {
    throw new Error(
      `No control token for port ${port} (${controlTokenFilePath(port)}). Is the studio running on that port? Or pass --token.`,
    );
  }
}

export interface ControlCallOptions {
  readonly port: number;
  readonly token: string;
  /** Injectable for tests; defaults to the global fetch. */
  readonly fetchImpl?: typeof fetch;
}

/** One RPC round trip: POST the command, return the editor's result, throw the readable error. */
export async function callCommand(options: ControlCallOptions, command: string, args?: unknown): Promise<unknown> {
  const doFetch = options.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await doFetch(`http://127.0.0.1:${options.port}/__control/command`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [STUDIO_TOKEN_HEADER]: options.token },
      body: JSON.stringify({ command, args: args ?? {} }),
    });
  } catch {
    throw new Error(`Cannot reach the studio on port ${options.port} — is it running (bun run dev)?`);
  }
  const body = (await response.json().catch(() => null)) as { ok?: boolean; result?: unknown; error?: string } | null;
  if (body === null) {
    throw new Error(`The studio answered HTTP ${response.status} with an unreadable body.`);
  }
  if (response.status !== 200 || body.ok !== true) {
    throw new Error(body.error ?? `The studio rejected "${command}" (HTTP ${response.status}).`);
  }
  return body.result;
}
