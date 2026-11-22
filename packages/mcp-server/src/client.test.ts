// @module-tag integration
// outcome-flags: this standalone MCP server has no release-flag reads.
import { createServer as createNetServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { afterEach, beforeEach, expect, it } from 'vitest';
import {
  FakeBrowser,
  type StudioFixture,
  startStudioFixture,
  TEST_TOKEN,
} from '../../../server/control-ws/test-support';
import { StudioConnection } from './client';

/**
 * The MCP server's Studio connection against the REAL gateway on a loopback port (the editor tab is a
 * WebSocket client in the browser role): results come back as data, gateway refusals as readable errors,
 * one connection is shared, and it is opened again after it drops.
 */

let studio: StudioFixture;
let connection: StudioConnection;
const tabs: FakeBrowser[] = [];

beforeEach(async () => {
  studio = await startStudioFixture();
  connection = new StudioConnection({ port: studio.port, token: TEST_TOKEN });
});

afterEach(async () => {
  connection.close();
  for (const tab of tabs.splice(0)) await tab.close();
  await studio.close();
});

async function tab(handler?: Parameters<typeof FakeBrowser.connect>[1]['handler']): Promise<FakeBrowser> {
  const browser = await FakeBrowser.connect(studio.url, handler === undefined ? {} : { handler });
  tabs.push(browser);
  return browser;
}

/** A loopback port with no listener: bound to find a free number, then released. */
function freeClosedPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createNetServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address() as AddressInfo;
      probe.close(() => resolve(port));
    });
  });
}

it('returns the tab result over the shared connection, and fails readably with no Studio', async () => {
  // Given: one tab that echoes the document id
  await tab((action, params) => ({ action, rootId: (params as { rootId?: string }).rootId }));
  // When: two tools call through the same connection
  expect(await connection.call('readDocument', { rootId: 'scout' })).toEqual({
    action: 'readDocument',
    rootId: 'scout',
  });
  expect(await connection.listTargets()).toHaveLength(1);
  // Then: both answered, and a call to a port with no Studio fails readably
  // A released port has no listener. Some runtimes report the refused connection only after a long wait, so the
  // connect bound is short: the outcome under test is the readable error, not the runtime's refusal timing.
  const closedPort = await freeClosedPort();
  const elsewhere = new StudioConnection({ port: closedPort, token: TEST_TOKEN, connectTimeoutMs: 1_000 });
  await expect(elsewhere.call('listDocuments', {})).rejects.toThrow(
    new RegExp(`Cannot reach the studio on port ${closedPort}`),
  );
});

it('turns gateway refusals into readable errors with the candidates to choose from', async () => {
  // Given: no tab
  // When / Then: not_ready names its code and the action to take
  await expect(connection.call('listDocuments', {})).rejects.toThrow(/open Prompt Studio in a browser.*\(not_ready\)/s);
  // Given: two tabs
  const first = await tab();
  const second = await tab();
  // When / Then: an untargeted call lists both browserIds; a targeted one reaches only that tab
  await expect(connection.call('listDocuments', {})).rejects.toThrow(
    new RegExp(`${first.browserId}[\\s\\S]*${second.browserId}|${second.browserId}[\\s\\S]*${first.browserId}`),
  );
  expect(await connection.call('listDocuments', {}, second.browserId)).toEqual({ ran: 'listDocuments' });
  expect(first.received).toHaveLength(0);
  // And: invalid params are refused before routing
  await expect(connection.call('readDocument', {}, second.browserId)).rejects.toThrow(
    /rootId is required.*invalid_input/s,
  );
  expect(second.received).toHaveLength(1);
});

it('reconnects on the next call after the gateway closed the connection', async () => {
  // Given: a tab and a connection that has been used
  await tab();
  await connection.call('listDocuments', {});
  // When: the gateway closes all controller sockets (a restart of the gateway on the same port is simulated
  // by terminating the server-side sockets)
  for (const client of studio.routes.gateway['connections' as never] as Set<{
    role: string;
    socket: { terminate(): void };
  }>) {
    if (client.role === 'controller') client.socket.terminate();
  }
  await new Promise((resolve) => setTimeout(resolve, 50));
  // Then: the next call opens a new connection and succeeds
  expect(await connection.call('listDocuments', {})).toEqual({ ran: 'listDocuments' });
});
