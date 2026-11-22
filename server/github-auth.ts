import type { IncomingMessage, ServerResponse } from 'node:http';
import { type } from 'arktype';
import { STUDIO_TOKEN_HEADER, validateOrigin, validateToken } from '../src/bridge/fs-bridge';

const clientIdType = type('string').narrow((value) => /^[A-Za-z0-9_.-]{1,100}$/.test(value));
const deviceBody = type({ '+': 'reject', 'clientId?': clientIdType });
const emptyBody = type({ '+': 'reject' });
const seconds = type('number.integer > 0').atMost(86_400);
const deviceResponse = type({
  device_code: 'string > 0',
  user_code: /^[A-Z0-9]{4}-[A-Z0-9]{4}$/,
  verification_uri: '"https://github.com/login/device"',
  expires_in: seconds,
  interval: seconds,
});
const tokenResponse = type({ access_token: /^[A-Za-z0-9_]{1,512}$/, token_type: '"bearer"', 'expires_in?': seconds });
const userResponse = type({ login: /^[A-Za-z0-9-]{1,39}$/ });
const prefix = '/__studio/github';

function send(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 1024) throw new Error('Invalid request.');
    chunks.push(bytes);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

/** Device grant secrets live only in this server instance, never in browser responses or disk. */
export function createGithubAuth(options: { clientId?: string; fetch?: typeof fetch; now?: () => number } = {}) {
  const request = options.fetch ?? fetch;
  const now = options.now ?? Date.now;
  let clientId = options.clientId;
  let generation = 0;
  let session: { token: string; login: string; expiresAt: number } | undefined;
  let flow: { code: string; expiresAt: number; interval: number; nextPoll: number; polling: boolean } | undefined;

  function clear() {
    generation++;
    session = undefined;
    flow = undefined;
  }

  function getToken() {
    if (session && session.expiresAt <= now()) session = undefined;
    return session?.token;
  }

  async function github(url: string, init: RequestInit) {
    const response = await request(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
      headers: { Accept: 'application/json', 'User-Agent': 'Salir-Prompt-Studio', ...init.headers },
    });
    if (!response.ok) throw new Error('GitHub connection failed.');
    return response.json() as Promise<unknown>;
  }

  async function poll() {
    if (getToken()) return { ok: true, status: 'connected', login: session?.login };
    const active = flow;
    if (!active || active.expiresAt <= now()) {
      flow = undefined;
      return { ok: true, status: 'expired' };
    }
    const pending = () => ({ ok: true, status: 'pending', interval: active.interval });
    if (active.polling || now() < active.nextPoll) return pending();
    active.polling = true;
    active.nextPoll = now() + active.interval * 1000;
    const started = generation;
    try {
      const raw = await github('https://github.com/login/oauth/access_token', {
        method: 'POST',
        body: new URLSearchParams({
          client_id: clientId ?? '',
          device_code: active.code,
          grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }),
      });
      if (started !== generation || active.expiresAt <= now()) return { ok: true, status: 'expired' };
      if (typeof raw === 'object' && raw !== null && 'error' in raw) {
        if (raw.error === 'authorization_pending') return pending();
        if (raw.error === 'slow_down') {
          active.interval += 5;
          if (
            'interval' in raw &&
            typeof raw.interval === 'number' &&
            Number.isSafeInteger(raw.interval) &&
            raw.interval > active.interval &&
            raw.interval <= 86_400
          )
            active.interval = raw.interval;
          active.nextPoll = now() + active.interval * 1000;
          return pending();
        }
        clear();
        if (raw.error === 'expired_token' || raw.error === 'token_expired') return { ok: true, status: 'expired' };
        if (raw.error === 'access_denied') return { ok: true, status: 'denied' };
        throw new Error('GitHub connection failed.');
      }
      const token = tokenResponse(raw);
      if (token instanceof type.errors) throw new Error('GitHub connection failed.');
      const expiresAt = token.expires_in ? now() + token.expires_in * 1000 : Number.POSITIVE_INFINITY;
      const user = userResponse(
        await github('https://api.github.com/user', {
          headers: { Authorization: `Bearer ${token.access_token}`, 'X-GitHub-Api-Version': '2026-03-10' },
        }),
      );
      if (user instanceof type.errors) throw new Error('GitHub connection failed.');
      if (started !== generation || expiresAt <= now()) return { ok: true, status: 'expired' };
      session = { token: token.access_token, login: user.login, expiresAt };
      flow = undefined;
      return { ok: true, status: 'connected', login: user.login };
    } finally {
      active.polling = false;
    }
  }

  async function handle(
    req: IncomingMessage,
    res: ServerResponse,
    studioToken: string,
    allowedOrigins: readonly string[],
  ): Promise<boolean> {
    const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;
    if (pathname !== prefix && !pathname.startsWith(`${prefix}/`)) return false;
    const header = (name: string) => {
      const value = req.headers[name];
      return Array.isArray(value) ? value[0] : value;
    };
    if (!validateOrigin(header('origin'), allowedOrigins)) {
      send(res, 403, { ok: false, error: 'Forbidden.' });
      return true;
    }
    if (!validateToken(header(STUDIO_TOKEN_HEADER), studioToken)) {
      send(res, 401, { ok: false, error: 'Unauthorized.' });
      return true;
    }
    if (req.method === 'GET' && pathname === `${prefix}/status`) {
      send(res, 200, {
        ok: true,
        configured: !!clientId,
        connected: !!getToken(),
        ...(session ? { login: session.login } : {}),
      });
      return true;
    }
    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: 'Method not allowed.' });
      return true;
    }
    if (!['/device', '/poll', '/disconnect'].some((suffix) => pathname === prefix + suffix)) {
      send(res, 404, { ok: false, error: 'Not found.' });
      return true;
    }
    let body: typeof deviceBody.infer;
    try {
      const parsed = (pathname === `${prefix}/device` ? deviceBody : emptyBody)(await readBody(req));
      if (parsed instanceof type.errors) throw new Error('Invalid request.');
      body = parsed;
    } catch {
      send(res, 400, { ok: false, error: 'Invalid request.' });
      return true;
    }
    try {
      if (pathname === `${prefix}/disconnect`) {
        clear();
        send(res, 200, { ok: true });
      } else if (pathname === `${prefix}/poll`) {
        send(res, 200, await poll());
      } else {
        if (body.clientId) clientId = body.clientId;
        if (!clientId) {
          send(res, 409, { ok: false, error: 'Configure a GitHub App client ID with device flow enabled.' });
          return true;
        }
        clear();
        const started = generation;
        const result = deviceResponse(
          await github('https://github.com/login/device/code', {
            method: 'POST',
            body: new URLSearchParams({ client_id: clientId }),
          }),
        );
        if (result instanceof type.errors) throw new Error('GitHub connection failed.');
        if (started !== generation) {
          send(res, 409, { ok: false, error: 'Connection attempt cancelled.' });
          return true;
        }
        flow = {
          code: result.device_code,
          expiresAt: now() + result.expires_in * 1000,
          interval: result.interval,
          nextPoll: now() + result.interval * 1000,
          polling: false,
        };
        send(res, 200, {
          ok: true,
          userCode: result.user_code,
          verificationUri: result.verification_uri,
          expiresAt: flow.expiresAt,
          interval: flow.interval,
        });
      }
    } catch {
      send(res, 502, { ok: false, error: 'GitHub connection failed. Try connecting again.' });
    }
    return true;
  }
  return { getToken, handle };
}
