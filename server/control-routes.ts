import type { IncomingMessage, ServerResponse } from 'node:http';
import { STUDIO_TOKEN_HEADER, validateOrigin, validateToken } from '../src/bridge/fs-bridge';
import type { ControlCommandRequest, ControlHub, ControlResponse } from './control-hub';

/**
 * The control channel's HTTP surface (ADR-236; tasks #18–#20): three routes, shared verbatim by
 * the standalone server (server/app.ts) and the Vite dev plugin (fs-bridge.ts) — exactly like
 * the `/__studio/*` bridge, one implementation, two hosts.
 *
 *   GET  /__control/events?token=…   — the editor tab's SSE command stream (EventSource cannot
 *                                       set headers, so the per-boot token rides the query)
 *   POST /__control/response         — the tab answers a command (token header)
 *   POST /__control/command          — a CLI/MCP client submits a command (token header)
 *
 * SECURITY. This is the studio's first WRITE surface — the fs bridge stays read-only; the
 * control channel writes through the EDITOR (the browser tab runs the app's own handlers),
 * never to the filesystem directly. Same gates as the bridge on every route: loopback-bound
 * server, Origin check (SSE), per-boot token (query for SSE, header for POSTs), and no
 * paths/PII in error bodies. A command with no connected tab is a 503 with the actionable
 * "open the studio" message, not a silent hang.
 */

/** Shared gate constants — same validators as the fs bridge (timing-safe token compare). */

export interface ControlRoutesOptions {
  /** Absolute directory the per-boot token file is written to (parent of the token file). */
  readonly tokenDir: string;
  /** Server port — the token file is port-scoped so parallel studios never cross-talk. */
  readonly port: number;
  /** Allowed origins for the SSE stream (the studio's own dev/standalone origins). */
  readonly allowedOrigins: readonly string[];
}

function firstHeaderValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

/** Reads a request body as UTF-8 text, rejecting oversized payloads (defensive bound). */
function readBody(req: IncomingMessage, maxBytes = 2 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxBytes) {
        reject(new Error('payload too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

export interface ControlRoutes {
  /** True when the request was a `/__control/*` route (handled, response ended). */
  handle(req: IncomingMessage, res: ServerResponse): Promise<boolean>;
  /** Rejects pending commands and forgets the token file — call on shutdown. */
  dispose(): Promise<void>;
}

/** Extracted for tests: the token file name is a stable contract with the CLI/MCP clients. */
export function controlTokenFileName(port: number): string {
  return `prompt-studio-control-${port}.token`;
}

export async function createControlRoutes(
  hub: ControlHub,
  token: string,
  writeTokenFile: (path: string, contents: string) => Promise<void>,
  removeTokenFile: (path: string) => Promise<void>,
  options: ControlRoutesOptions,
): Promise<ControlRoutes> {
  const tokenPath = `${options.tokenDir}/${controlTokenFileName(options.port)}`;
  await writeTokenFile(tokenPath, token);

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (!url.pathname.startsWith('/__control/')) return false;

    if (url.pathname === '/__control/events') {
      if (req.method !== 'GET') {
        sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
        return true;
      }
      if (!validateOrigin(firstHeaderValue(req.headers.origin), options.allowedOrigins)) {
        sendJson(res, 403, { ok: false, error: 'Forbidden.' });
        return true;
      }
      if (!validateToken(url.searchParams.get('token'), token)) {
        sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
        return true;
      }

      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const detach = hub.attachClient((payload) => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      });
      // A comment beat keeps intermediaries from idling the stream out; also proves liveness.
      const heartbeat = setInterval(() => res.write(': ping\n\n'), 15_000);
      req.on('close', () => {
        clearInterval(heartbeat);
        detach();
      });
      return true;
    }

    if (url.pathname === '/__control/response' || url.pathname === '/__control/command') {
      if (req.method !== 'POST') {
        sendJson(res, 405, { ok: false, error: 'Method not allowed.' });
        return true;
      }
      // Same posture as the bridge: shell clients send no Origin (allowed), a foreign page is not.
      if (!validateOrigin(firstHeaderValue(req.headers.origin), options.allowedOrigins)) {
        sendJson(res, 403, { ok: false, error: 'Forbidden.' });
        return true;
      }
      if (!validateToken(firstHeaderValue(req.headers[STUDIO_TOKEN_HEADER]), token)) {
        sendJson(res, 401, { ok: false, error: 'Unauthorized.' });
        return true;
      }
      // Fail fast BEFORE reading the body: a command relay with no tab is dead on arrival.
      if (url.pathname === '/__control/command' && !hub.hasClient()) {
        sendJson(res, 503, {
          ok: false,
          error: 'No editor tab is connected — open the prompt studio in a browser first.',
        });
        return true;
      }

      let body: unknown;
      try {
        body = JSON.parse(await readBody(req));
      } catch {
        sendJson(res, 400, { ok: false, error: 'Malformed JSON body.' });
        return true;
      }

      if (url.pathname === '/__control/response') {
        hub.receiveResponse(body as ControlResponse);
        sendJson(res, 200, { ok: true });
        return true;
      }

      const { command, args } = (body ?? {}) as ControlCommandRequest;
      if (typeof command !== 'string' || command.length === 0) {
        sendJson(res, 400, { ok: false, error: 'A command name is required.' });
        return true;
      }
      try {
        const result = await hub.submit({ command, args });
        sendJson(res, 200, { ok: true, result });
      } catch (error) {
        sendJson(res, 500, { ok: false, error: error instanceof Error ? error.message : 'Editor command failed.' });
      }
      return true;
    }

    sendJson(res, 404, { ok: false, error: 'Not found.' });
    return true;
  }

  return {
    handle,
    async dispose() {
      hub.dispose();
      await removeTokenFile(tokenPath).catch(() => {});
    },
  };
}
