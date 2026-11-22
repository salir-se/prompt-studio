// @module-tag pure
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import {
  assertNoBlockedNetworkRequests,
  clearBlockedNetworkRequests,
  formatBlockedReport,
  getBlockedNetworkRequests,
  installNetworkGuard,
} from './network-guard';

// The guard itself is installed by the shared setup (setup.ts), which this
// package's vitest config loads — so `globalThis.fetch` IS the guard here.
// These tests assert the guard's observable contract.

describe('network guard (installed by shared setup)', () => {
  afterEach(clearBlockedNetworkRequests);

  it('throws instantly on a network request, naming method and url', async () => {
    clearBlockedNetworkRequests();
    await expect(fetch('https://billing.salir.test/x', { method: 'POST' })).rejects.toThrow(
      /POST https:\/\/billing\.salir\.test\/x/,
    );
  });

  it('records every blocked attempt with order, for trackable refactors', async () => {
    clearBlockedNetworkRequests();
    await expect(fetch('https://a.salir.test/1')).rejects.toThrow();
    await expect(fetch('https://b.salir.test/2', { method: 'DELETE' })).rejects.toThrow();
    expect(getBlockedNetworkRequests()).toEqual([
      { method: 'GET', url: 'https://a.salir.test/1', order: 1 },
      { method: 'DELETE', url: 'https://b.salir.test/2', order: 2 },
    ]);
  });

  it('includes the complete inventory so far in each thrown message (no whack-a-mole)', async () => {
    clearBlockedNetworkRequests();
    await expect(fetch('https://first.salir.test/')).rejects.toThrow();
    const second = await fetch('https://second.salir.test/').catch((err: Error) => err.message);
    expect(second).toContain('first.salir.test');
    expect(second).toContain('second.salir.test');
  });

  it('reads the method from a Request object input', async () => {
    clearBlockedNetworkRequests();
    await expect(fetch(new Request('https://req.salir.test/', { method: 'PUT' }))).rejects.toThrow(
      /PUT https:\/\/req\.salir\.test\//,
    );
  });

  it('lets data: URLs through to the real fetch (no network involved)', async () => {
    clearBlockedNetworkRequests();
    const res = await fetch('data:text/plain,hello');
    expect(await res.text()).toBe('hello');
    expect(getBlockedNetworkRequests()).toEqual([]);
  });

  it('reinstalls after another test leaves a read-only fetch property', async () => {
    // Given: a previous file left fetch read-only on the shared global.
    const original = Object.getOwnPropertyDescriptor(globalThis, 'fetch')!;
    Object.defineProperty(globalThis, 'fetch', {
      value: async () => new Response(),
      writable: false,
      configurable: true,
    });
    try {
      // When: the setup reinstalls the network guard.
      expect(() => installNetworkGuard()).not.toThrow();
      // Then: requests are still blocked.
      await expect(fetch('https://blocked.salir.test/')).rejects.toThrow('unit test attempted a real network request');
    } finally {
      Object.defineProperty(globalThis, 'fetch', original);
    }
  });

  it('formats the consolidated report one attempt per line', () => {
    expect(
      formatBlockedReport([
        { method: 'GET', url: 'https://x/', order: 1 },
        { method: 'POST', url: 'https://y/', order: 2 },
      ]),
    ).toBe('  1. GET https://x/\n  2. POST https://y/');
  });

  it('fails a test that catches the fetch error, then clears the recorded attempts', async () => {
    await expect(fetch('https://caught.salir.test/')).rejects.toThrow();

    expect(() => assertNoBlockedNetworkRequests()).toThrow(
      /blocked 1 network request.*GET https:\/\/caught\.salir\.test\//s,
    );
    expect(getBlockedNetworkRequests()).toEqual([]);
  });
});

describe('shared test setup imports', () => {
  it('does not load happy-dom in Node test environments', () => {
    const source = readFileSync(new URL('./setup.ts', import.meta.url), 'utf8');

    expect(source).not.toMatch(/^import .*happy-dom-storage/m);
    expect(source).toContain("if (typeof window !== 'undefined')");
    expect(source).toContain("await import('./happy-dom-storage')");
  });
});
