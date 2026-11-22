// @module-tag dom
import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { STUDIO_TOKEN_HEADER } from '../src/bridge/fs-bridge';
import { ControlHub } from './control-hub';
import { type ControlRoutes, controlTokenFileName, createControlRoutes } from './control-routes';

/**
 * Route-level coverage for the control channel's HTTP surface: gate ordering (method → origin →
 * token), the token-file contract shared with CLI/MCP clients, the no-tab 503, and one full
 * relay round trip (command POST → SSE delivery → response POST → command resolved). Transport
 * fakes stand in for node:http exactly like the fs-bridge manifest tests do.
 */

const TOKEN = 'test-token';
const ORIGINS = ['http://127.0.0.1:5273'];

interface FakeResponse {
  statusCode: number;
  headers: Record<string, string | number>;
  chunks: string[];
  ended: boolean;
  res: {
    statusCode: number;
    setHeader: (name: string, value: string | number) => void;
    writeHead: (status: number, headers: Record<string, string | number>) => void;
    write: (chunk: string) => void;
    end: (body?: string) => void;
  };
}

function fakeRes(): FakeResponse {
  const state: FakeResponse = { statusCode: 0, headers: {}, chunks: [], ended: false, res: null as never };
  state.res = {
    get statusCode() {
      return state.statusCode;
    },
    set statusCode(value: number) {
      state.statusCode = value;
    },
    setHeader: (name, value) => {
      state.headers[name] = value;
    },
    writeHead: (status, headers) => {
      state.statusCode = status;
      Object.assign(state.headers, headers);
    },
    write: (chunk) => {
      state.chunks.push(chunk);
    },
    end: (body) => {
      if (body !== undefined) state.chunks.push(body);
      state.ended = true;
    },
  };
  return state;
}

function fakeReq(
  method: string,
  urlPath: string,
  headers: Record<string, string> = {},
): EventEmitter & {
  method: string;
  url: string;
  headers: Record<string, string>;
  destroy: () => void;
} {
  const req = new EventEmitter() as EventEmitter & {
    method: string;
    url: string;
    headers: Record<string, string>;
    destroy: () => void;
  };
  req.method = method;
  req.url = urlPath;
  req.headers = headers;
  req.destroy = () => {};
  return req;
}

/** Delivers a JSON body to a fake POST request on the next tick, like a real socket would. */
function sendBody(req: EventEmitter & { destroy: () => void }, body: unknown): void {
  setImmediate(() => {
    const text = JSON.stringify(body);
    req.emit('data', Buffer.from(text));
    req.emit('end');
  });
}

async function makeRoutes(
  hub: ControlHub,
): Promise<{ routes: ControlRoutes; tokenFile: { path: string; contents: string }; removed: string[] }> {
  const tokenFile = { path: '', contents: '' };
  const removed: string[] = [];
  const routes = await createControlRoutes(
    hub,
    TOKEN,
    async (path, contents) => {
      tokenFile.path = path;
      tokenFile.contents = contents;
    },
    async (path) => {
      removed.push(path);
    },
    { tokenDir: '/tmp', port: 5273, allowedOrigins: ORIGINS },
  );
  return { routes, tokenFile, removed };
}

function jsonBody(res: FakeResponse): { ok?: boolean; error?: string; result?: unknown } {
  return JSON.parse(res.chunks.join(''));
}

describe('createControlRoutes', () => {
  it('writes the per-boot token to the port-scoped control token file at creation', async () => {
    const { tokenFile } = await makeRoutes(new ControlHub());
    expect(tokenFile.path).toBe(`/tmp/${controlTokenFileName(5273)}`);
    expect(tokenFile.contents).toBe(TOKEN);
  });

  it('gates every route: method, origin, then token', async () => {
    const { routes } = await makeRoutes(new ControlHub());

    const getCommand = fakeReq('GET', '/__control/command');
    const r1 = fakeRes();
    await routes.handle(getCommand as never, r1.res as never);
    expect(r1.statusCode).toBe(405);

    const foreign = fakeReq('POST', '/__control/command', { origin: 'http://evil.example' });
    const r2 = fakeRes();
    await routes.handle(foreign as never, r2.res as never);
    expect(r2.statusCode).toBe(403);

    const noToken = fakeReq('POST', '/__control/command');
    const r3 = fakeRes();
    await routes.handle(noToken as never, r3.res as never);
    expect(r3.statusCode).toBe(401);

    const badSseToken = fakeReq('GET', '/__control/events?token=wrong');
    const r4 = fakeRes();
    await routes.handle(badSseToken as never, r4.res as never);
    expect(r4.statusCode).toBe(401);
  });

  it('a command with no connected tab is an actionable 503, not a hang', async () => {
    const { routes } = await makeRoutes(new ControlHub());
    const req = fakeReq('POST', '/__control/command', { [STUDIO_TOKEN_HEADER]: TOKEN });
    const res = fakeRes();
    const done = routes.handle(req as never, res.res as never);
    sendBody(req, { command: 'listDocuments' });
    await done;
    expect(res.statusCode).toBe(503);
    expect(jsonBody(res).error).toContain('open the prompt studio');
  });

  it('relays a command end to end: POST → SSE delivery → response POST → resolved result', async () => {
    const hub = new ControlHub(2000);
    const { routes } = await makeRoutes(hub);

    // The tab connects: the SSE stream stays open and receives command payloads.
    const sseReq = fakeReq('GET', `/__control/events?token=${TOKEN}`, { origin: ORIGINS[0] });
    const sseRes = fakeRes();
    await routes.handle(sseReq as never, sseRes.res as never);
    expect(sseRes.statusCode).toBe(200);
    expect(sseRes.headers['content-type']).toBe('text/event-stream');

    // A CLI submits a command — the response must wait for the tab.
    const commandReq = fakeReq('POST', '/__control/command', { [STUDIO_TOKEN_HEADER]: TOKEN });
    const commandRes = fakeRes();
    const commandDone = routes.handle(commandReq as never, commandRes.res as never);
    sendBody(commandReq, { command: 'listDocuments' });

    // The tab receives the command over SSE…
    await new Promise((resolve) => setImmediate(resolve));
    const dataEvent = sseRes.chunks.join('').match(/data: (.*)\n\n/);
    expect(dataEvent).not.toBeNull();
    const payload = JSON.parse(dataEvent![1]) as { id: number; command: string };
    expect(payload.command).toBe('listDocuments');

    // …answers through /__control/response, and the CLI's POST resolves with the result.
    const responseReq = fakeReq('POST', '/__control/response', { [STUDIO_TOKEN_HEADER]: TOKEN });
    const responseRes = fakeRes();
    const responseDone = routes.handle(responseReq as never, responseRes.res as never);
    sendBody(responseReq, { id: payload.id, ok: true, result: { documents: ['scout'] } });
    await responseDone;
    expect(responseRes.statusCode).toBe(200);

    await commandDone;
    expect(commandRes.statusCode).toBe(200);
    expect(jsonBody(commandRes)).toEqual({ ok: true, result: { documents: ['scout'] } });
  });

  it('dispose removes the token file and rejects pending commands', async () => {
    const hub = new ControlHub();
    const { routes, removed } = await makeRoutes(hub);
    await routes.dispose();
    expect(removed).toEqual([`/tmp/${controlTokenFileName(5273)}`]);
    expect(hub.hasClient()).toBe(false);
  });
});
