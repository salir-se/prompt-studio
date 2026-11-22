import type { IncomingMessage, ServerResponse } from 'node:http';
import { validateOrigin } from '../src/bridge/fs-bridge';

/** The old page has no valid boot token; only its trusted, same-origin browser may recover one. */
export function handleSessionRequest(
  req: IncomingMessage,
  res: ServerResponse,
  token: string,
  allowedOrigins: readonly string[],
): void {
  const origin = req.headers.origin;
  const trusted = typeof origin === 'string' && origin.length > 0 && validateOrigin(origin, allowedOrigins);
  const sameOrigin =
    trusted &&
    origin === `http://${req.headers.host}` &&
    (!req.headers['sec-fetch-site'] || req.headers['sec-fetch-site'] === 'same-origin');
  const status = !sameOrigin ? 403 : req.method !== 'POST' ? 405 : 200;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(
    JSON.stringify(
      status === 200
        ? { ok: true, token }
        : {
            ok: false,
            error: status === 403 ? 'Forbidden.' : 'Method not allowed.',
          },
    ),
  );
}
