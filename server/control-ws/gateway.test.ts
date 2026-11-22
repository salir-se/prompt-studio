// @vitest-environment node
// @module-tag integration
/**
 * Acceptance tests of the WebSocket remote-control gateway (docs/remote-control.md; spec AT-01, AT-03, AT-04,
 * AT-15, AT-20). Every test drives REAL WebSockets against the REAL gateway on an ephemeral loopback port: the
 * controller is the shipped `ControlClient`, the editor tab is a WebSocket client in the browser role.
 */
import {
  COMMAND_CATALOG,
  ControlClient,
  ControlCommandError,
  ControlConnectionError,
  MAX_FRAME_BYTES,
  PROTOCOL_VERSION,
} from '@prompt-studio/control-protocol';
import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { STUDIO_TOKEN_HEADER } from '../../src/bridge/fs-bridge';
import { loopbackFetch } from '../loopback-fetch';
import {
  FakeBrowser,
  rawConnect,
  READY_STATE,
  type StudioFixture,
  startStudioFixture,
  TEST_ORIGIN,
  TEST_TOKEN,
} from './test-support';

let studio: StudioFixture;
const opened: Array<{ close(): unknown }> = [];

async function start(options: Parameters<typeof startStudioFixture>[0] = {}): Promise<StudioFixture> {
  studio = await startStudioFixture(options);
  return studio;
}

async function browser(options: Parameters<typeof FakeBrowser.connect>[1] = {}): Promise<FakeBrowser> {
  const tab = await FakeBrowser.connect(studio.url, options);
  opened.push(tab);
  return tab;
}

async function controller(): Promise<ControlClient> {
  const client = await ControlClient.connect({ url: studio.url, token: TEST_TOKEN });
  opened.push(client);
  return client;
}

afterEach(async () => {
  for (const item of opened.splice(0)) await item.close();
  await studio?.close();
});

describe('AT-01 handshake and capabilities', () => {
  it('welcomes a controller with the negotiated version, the command catalog and the limits', async () => {
    // Given: a running Studio
    await start();
    // When: a controller connects with the shared token
    const client = await controller();
    // Then: welcome names version 1.0, the nine commands with their schemas, and the limits
    expect(client.welcome).toMatchObject({ type: 'welcome', protocolVersion: PROTOCOL_VERSION, role: 'controller' });
    expect(client.commands.map((command) => command.name)).toEqual(COMMAND_CATALOG.map((command) => command.name));
    expect(client.commands.find((command) => command.name === 'editDocument')?.params).toMatchObject({
      required: ['rootId', 'text'],
    });
    expect(client.welcome.limits).toEqual({ maxFrameBytes: MAX_FRAME_BYTES, maxPending: 32, maxTimeoutMs: 300_000 });
  });

  it('fails an incompatible version before any command can run', async () => {
    // Given: a Studio with a ready tab
    await start();
    const tab = await browser();
    // When: a controller offers only an unknown protocol version, then sends a command anyway
    const refused = ControlClient.connect({ url: studio.url, token: TEST_TOKEN, protocolVersions: ['9.0'] });
    refused.catch(() => {}); // asserted below
    const raw = await rawConnect(studio.url, {
      firstMessage: { type: 'hello', role: 'controller', protocolVersions: ['9.0'], token: TEST_TOKEN },
    });
    // Then: the client sees unsupported_version, the socket closes with 4426, and the tab ran nothing
    await expect(refused).rejects.toMatchObject({ error: { code: 'unsupported_version' } });
    expect(raw.closeCode).toBe(4426);
    expect(raw.messages).toEqual([{ type: 'error', error: expect.objectContaining({ code: 'unsupported_version' }) }]);
    expect(tab.received).toEqual([]);
  });

  it('closes a connection that sends no hello in time, or a first message that is not hello', async () => {
    // Given: a Studio with a short hello timeout
    await start({ helloTimeoutMs: 50 });
    // When: one socket stays silent and another sends a command first
    const silent = await rawConnect(studio.url);
    const early = await rawConnect(studio.url, {
      firstMessage: { type: 'command', requestId: 'r', commandId: 'c', action: 'listDocuments' },
    });
    // Then: both are closed before authentication (4408, 4400)
    expect(silent.closeCode).toBe(4408);
    expect(early.closeCode).toBe(4400);
  });
});

describe('AT-03 target selection with two tabs', () => {
  it('refuses an untargeted command with ambiguous_target and the candidates; a targeted one reaches only that tab', async () => {
    // Given: two ready editor tabs and a controller
    await start();
    const first = await browser({ state: { ...READY_STATE, projectName: 'First' } });
    const second = await browser({ state: { ...READY_STATE, projectName: 'Second' } });
    const client = await controller();

    // When: the controller sends a command without a target
    const ambiguous = await client.command({ action: 'listDocuments' });
    // Then: it fails with ambiguous_target, lists both tabs, and neither tab received it
    expect(ambiguous.state).toBe('failed');
    expect(ambiguous.error?.code).toBe('ambiguous_target');
    expect(ambiguous.error?.candidates?.map((candidate) => candidate.browserId).sort()).toEqual(
      [first.browserId, second.browserId].sort(),
    );
    expect(first.received.length + second.received.length).toBe(0);

    // When: it targets the second tab
    const targeted = await client.command({ action: 'listDocuments', target: { browserId: second.browserId } });
    // Then: only the second tab ran it and the result names it
    expect(targeted).toMatchObject({
      state: 'completed',
      completionLevel: 'applied',
      target: { browserId: second.browserId },
      data: { ran: 'listDocuments' },
    });
    expect(second.received.map((command) => command.action)).toEqual(['listDocuments']);
    expect(first.received).toEqual([]);
  });

  it('lists targets with their reported state and follows state.update', async () => {
    // Given: one tab that is still loading
    await start();
    const tab = await browser({ state: { ...READY_STATE, ready: false } });
    const client = await controller();
    expect(await client.listTargets()).toEqual([
      expect.objectContaining({ browserId: tab.browserId, ready: false, projectName: 'Default' }),
    ]);
    // When: the tab reports it is ready with a document open in the write view
    tab.send({
      type: 'state.update',
      state: { ...READY_STATE, documentId: 'support-triage', view: 'write' },
    });
    // Then: targets reflect the new state (the update is processed before the later targets.list)
    expect(await client.listTargets()).toEqual([
      expect.objectContaining({ browserId: tab.browserId, ready: true, documentId: 'support-triage', view: 'write' }),
    ]);
  });

  it('keeps a browserId across a reload only when no live socket holds it', async () => {
    // Given: a tab with an assigned id
    await start();
    const tab = await browser();
    const id = tab.browserId;
    // When: a second tab asks for the same id while the first is connected
    const thief = await browser({ resumeBrowserId: id });
    // Then: it gets a different id
    expect(thief.browserId).not.toBe(id);
    // When: the first tab reloads (old socket gone) and asks for its id back
    await tab.close();
    const reloaded = await browser({ resumeBrowserId: id });
    // Then: it keeps its id
    expect(reloaded.browserId).toBe(id);
  });
});

describe('AT-04 no tab, and a tab that disappears', () => {
  it('fails with not_ready when no editor tab is connected', async () => {
    // Given: a Studio with no tab
    await start();
    const client = await controller();
    // When: a command arrives
    const result = await client.command({ action: 'listDocuments' });
    // Then: it fails with not_ready and an actionable message
    expect(result.state).toBe('failed');
    expect(result.error).toMatchObject({ code: 'not_ready', outcome: 'none' });
    expect(result.error?.message).toMatch(/open Prompt Studio in a browser/);
  });

  it('fails with disconnected and outcome unknown when the tab closes mid-command', async () => {
    // Given: a tab that receives commands but does not answer
    await start();
    const tab = await browser();
    tab.answer = false;
    const client = await controller();
    // When: a command is routed to it and the tab closes before answering
    const pending = client.command({ action: 'editDocument', params: { rootId: 'doc', text: 'new' } });
    await tab.waitForCommands(1);
    await tab.close();
    // Then: the controller learns the command may have run
    const result = await pending;
    expect(result.state).toBe('failed');
    expect(result.error).toMatchObject({ code: 'disconnected', outcome: 'unknown' });
    expect(result.target).toEqual({ browserId: tab.browserId });
  });

  it('fails with timeout and outcome unknown when the tab never answers', async () => {
    // Given: a tab that never answers
    await start();
    const tab = await browser();
    tab.answer = false;
    const client = await controller();
    // When: a command with a 50 ms timeout is sent
    const result = await client.command({ action: 'listDocuments', timeoutMs: 50 });
    // Then: it times out with outcome unknown, and a late answer is ignored
    expect(result.error).toMatchObject({ code: 'timeout', outcome: 'unknown' });
    tab.send({ type: 'command.result', commandId: result.commandId, ok: true, data: 'late' });
    await client.listTargets(); // round trip: the late result has been processed
    expect(studio.logs).toContainEqual(expect.objectContaining({ event: 'result.ignored', reason: 'unknown_command' }));
  });
});

describe('validation before routing', () => {
  it('rejects unknown commands, bad params, unsupported completion, duplicates and bad timeouts without reaching the tab', async () => {
    // Given: a ready tab that never answers (so a routed command stays in flight)
    await start();
    const tab = await browser();
    tab.answer = false;
    const client = await controller();
    // When / Then: each invalid command fails with its stable code
    expect((await client.command({ action: 'deleteEverything' })).error?.code).toBe('unsupported_command');
    expect((await client.command({ action: 'readDocument', params: {} })).error?.code).toBe('invalid_input');
    expect((await client.command({ action: 'readDocument', params: { rootId: 7 } })).error?.code).toBe('invalid_input');
    expect((await client.command({ action: 'listDocuments', params: { surprise: true } })).error?.message).toMatch(
      /not a parameter/,
    );
    expect((await client.command({ action: 'listDocuments', waitFor: 'rendered' })).error?.code).toBe(
      'unsupported_completion',
    );
    expect((await client.command({ action: 'listDocuments', timeoutMs: 999_999 })).error?.code).toBe('invalid_input');
    expect(tab.received).toEqual([]);

    // And: a commandId already in flight is refused as a duplicate
    const first = client.command({ action: 'listDocuments', commandId: 'same-intent', timeoutMs: 2_000 });
    await tab.waitForCommands(1);
    const duplicate = await client.command({ action: 'listDocuments', commandId: 'same-intent' });
    expect(duplicate.error?.code).toBe('duplicate_command');
    expect(tab.received).toHaveLength(1);
    tab.send({ type: 'command.result', commandId: 'same-intent', ok: true, data: [] });
    expect((await first).state).toBe('completed');
  });

  it("relays a tab's failure as command_failed with the tab's message", async () => {
    // Given: a tab whose handler throws
    await start();
    await browser({
      handler: () => {
        throw new Error('Open "scout" first (openDocument).');
      },
    });
    const client = await controller();
    // When: a command runs
    const result = await client.command({ action: 'editDocument', params: { rootId: 'scout', text: 'x' } });
    // Then: the error carries the tab's readable message
    expect(result.error).toMatchObject({ code: 'command_failed', message: 'Open "scout" first (openDocument).' });
  });

  it("relays a tab's stable error code, but never lets a tab claim a transport code", async () => {
    // Given: a tab that reports missing_target for one action and a forged timeout code for another
    await start();
    await browser({
      handler: (action) => {
        if (action === 'readSection') throw new ControlCommandError('missing_target', 'No section "x".');
        throw Object.assign(new ControlCommandError('command_failed', 'Forged.'), { code: 'timeout' });
      },
    });
    const client = await controller();
    // When: both commands run
    const missing = await client.command({ action: 'readSection', params: { rootId: 'r', sectionId: 'x' } });
    const forged = await client.command({ action: 'listDocuments' });
    // Then: the allowed code reaches the controller; the forged one reads as command_failed
    expect(missing.error).toMatchObject({ code: 'missing_target', message: 'No section "x".', outcome: 'none' });
    expect(forged.error).toMatchObject({ code: 'command_failed', message: 'Forged.' });
  });
});

describe('AT-15 trust boundaries', () => {
  it('ignores a result sent by a tab the command was not routed to', async () => {
    // Given: two tabs; the first holds a command without answering
    await start();
    const owner = await browser();
    owner.answer = false;
    const other = await browser();
    const client = await controller();
    const pending = client.command({
      action: 'readDocument',
      params: { rootId: 'doc' },
      target: { browserId: owner.browserId },
    });
    await owner.waitForCommands(1);
    const commandId = owner.received[0]?.commandId as string;
    // When: the other tab sends a forged result for that command
    other.send({ type: 'command.result', commandId, ok: true, data: 'forged' });
    await client.listTargets(); // round trip so the forged frame is processed first
    // Then: it is logged and ignored; the owner's real answer is the result
    expect(studio.logs).toContainEqual(
      expect.objectContaining({ event: 'result.ignored', reason: 'wrong_browser', browserId: other.browserId }),
    );
    owner.send({ type: 'command.result', commandId, ok: true, data: 'genuine' });
    expect(await pending).toMatchObject({
      state: 'completed',
      data: 'genuine',
      target: { browserId: owner.browserId },
    });
  });

  it('closes a bad token with 4401 and refuses a foreign Origin with 403', async () => {
    // Given: a running Studio
    await start();
    // When: a controller uses the wrong token
    const wrong = ControlClient.connect({ url: studio.url, token: 'not-the-token' });
    wrong.catch(() => {}); // asserted below
    const raw = await rawConnect(studio.url, {
      firstMessage: { type: 'hello', role: 'controller', protocolVersions: [PROTOCOL_VERSION], token: 'nope' },
    });
    // Then: 4401, with no error frame that could tell an attacker anything
    await expect(wrong).rejects.toBeInstanceOf(ControlConnectionError);
    await expect(wrong).rejects.toMatchObject({ error: { code: 'unauthorized' } });
    expect(raw).toEqual({ closeCode: 4401, messages: [] });

    // When: a page on another origin tries to upgrade; and the Studio's own origin does
    const foreign = await rawConnect(studio.url, { origin: 'https://evil.example' });
    const own = await rawConnect(studio.url, {
      origin: TEST_ORIGIN,
      firstMessage: { type: 'hello', role: 'controller', protocolVersions: [PROTOCOL_VERSION], token: 'nope' },
    });
    // Then: the foreign page gets 403 before any WebSocket exists; the own origin reaches the hello check
    expect(foreign.status).toBe(403);
    expect(own.closeCode).toBe(4401);
  });

  it('never writes the token or command params to the log', async () => {
    // Given: a Studio, a rejected hello and a timed-out command carrying a secret-looking param
    await start();
    await rawConnect(studio.url, {
      firstMessage: { type: 'hello', role: 'controller', protocolVersions: [PROTOCOL_VERSION], token: 'leaky-token' },
    });
    const tab = await browser();
    tab.answer = false;
    const client = await controller();
    await client.command({ action: 'editDocument', params: { rootId: 'doc', text: 'SECRET-TEXT' }, timeoutMs: 20 });
    // Then: the log names events, never the token or params
    const log = JSON.stringify(studio.logs);
    expect(studio.logs.length).toBeGreaterThan(0);
    expect(log).not.toContain('leaky-token');
    expect(log).not.toContain(TEST_TOKEN);
    expect(log).not.toContain('SECRET-TEXT');
  });
});

describe('AT-20 limits', () => {
  it('closes a connection that sends an oversized frame with 1009; the client refuses one locally', async () => {
    // Given: a Studio that accepts frames up to 4 KiB, and a ready tab
    await start({ maxFrameBytes: 4096 });
    const tab = await browser();
    const client = await controller();
    // When: the client builds a command larger than the advertised limit
    const local = await client.command({ action: 'editDocument', params: { rootId: 'doc', text: 'x'.repeat(5000) } });
    // Then: it is refused before sending, and the connection stays usable
    expect(local.error).toMatchObject({ code: 'payload_too_large', outcome: 'none' });
    expect(client.isOpen).toBe(true);
    expect((await client.command({ action: 'listDocuments' })).state).toBe('completed');

    // When: a raw socket sends an oversized frame after a valid hello
    const socket = new WebSocket(studio.url);
    const closeCode = await new Promise<number>((resolve) => {
      socket.on('open', () => {
        socket.send(
          JSON.stringify({
            type: 'hello',
            role: 'controller',
            protocolVersions: [PROTOCOL_VERSION],
            token: TEST_TOKEN,
          }),
        );
        socket.send('x'.repeat(5000));
      });
      socket.on('error', () => {});
      socket.on('close', (code) => resolve(code));
    });
    // Then: the gateway closes it with 1009 and the tab ran nothing from it
    expect(closeCode).toBe(1009);
    expect(tab.received.map((command) => command.action)).toEqual(['listDocuments']);
  });

  it('refuses a command beyond the per-controller pending limit', async () => {
    // Given: a pending limit of 2 and a tab that holds commands
    await start({ maxPending: 2 });
    const tab = await browser();
    tab.answer = false;
    const client = await controller();
    // When: three commands are sent at once
    const held = [
      client.command({ action: 'listDocuments', timeoutMs: 2_000 }),
      client.command({ action: 'listDocuments', timeoutMs: 2_000 }),
    ];
    await tab.waitForCommands(2);
    const third = await client.command({ action: 'listDocuments' });
    // Then: the third fails with too_many_pending and never reaches the tab
    expect(third.error?.code).toBe('too_many_pending');
    expect(tab.received).toHaveLength(2);
    for (const command of tab.received)
      tab.send({ type: 'command.result', commandId: command.commandId, ok: true, data: 1 });
    expect((await Promise.all(held)).map((result) => result.state)).toEqual(['completed', 'completed']);
  });
});

describe('deprecated HTTP relay', () => {
  it('routes POST /__control/command through the gateway when a WebSocket tab is connected, with Deprecation headers', async () => {
    // Given: one WebSocket tab
    await start();
    const tab = await browser();
    const post = (body: unknown) =>
      loopbackFetch(`http://127.0.0.1:${studio.port}/__control/command`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', [STUDIO_TOKEN_HEADER]: TEST_TOKEN },
        body: JSON.stringify(body),
      });
    // When: an HTTP client posts a command
    const response = await post({ command: 'listDocuments', args: {} });
    // Then: the tab ran it and the response is marked deprecated
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, result: { ran: 'listDocuments' } });
    expect(response.headers.get('deprecation')).toBe('true');
    expect(response.headers.get('link')).toContain('remote-control.md');
    expect(tab.received).toHaveLength(1);

    // When: a second tab connects and the HTTP client sends an untargeted command
    const second = await browser();
    const ambiguous = await post({ command: 'listDocuments', args: {} });
    // Then: 409 with the ambiguous_target error and candidates; a browserId resolves it
    expect(ambiguous.status).toBe(409);
    expect(await ambiguous.json()).toMatchObject({
      ok: false,
      errorCode: 'ambiguous_target',
      candidates: expect.any(Array),
    });
    const targeted = await post({ command: 'listDocuments', args: {}, browserId: second.browserId });
    expect(targeted.status).toBe(200);
    expect(second.received).toHaveLength(1);
  });
});
