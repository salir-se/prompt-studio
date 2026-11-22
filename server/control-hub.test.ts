// @module-tag dom
import { describe, expect, it, vi } from 'vitest';
import { ControlHub, NO_CLIENT_ERROR } from './control-hub';

describe('ControlHub', () => {
  it('rejects commands immediately and actionably when no tab is connected', async () => {
    const hub = new ControlHub();
    await expect(hub.submit({ command: 'listDocuments' })).rejects.toThrow(NO_CLIENT_ERROR);
  });

  it('relays a command to the attached tab and resolves from its response', async () => {
    const hub = new ControlHub(1000);
    let delivered: { command: string; id: number } | undefined;
    hub.attachClient((payload) => {
      delivered = payload;
    });

    const pending = hub.submit({ command: 'readDocument', args: { rootId: 'scout' } });
    expect(delivered?.command).toBe('readDocument');
    expect(delivered?.id).toBe(1);

    expect(hub.receiveResponse({ id: delivered?.id ?? -1, ok: true, result: 'Scout text.' })).toBe(true);
    await expect(pending).resolves.toBe('Scout text.');
  });

  it('rejects from the tab error, and times out a tab that never answers', async () => {
    const hub = new ControlHub(20);
    let id = -1;
    hub.attachClient((payload) => {
      id = payload.id;
    });

    const failing = hub.submit({ command: 'editDocument', args: {} });
    hub.receiveResponse({ id, ok: false, error: 'Unknown document "nope".' });
    await expect(failing).rejects.toThrow('Unknown document "nope".');

    vi.useFakeTimers();
    try {
      const timedOut = expect(hub.submit({ command: 'listDocuments' })).rejects.toThrow(
        'Editor did not answer "listDocuments" within 20ms.',
      );
      await vi.advanceTimersByTimeAsync(20);
      await timedOut;
    } finally {
      vi.useRealTimers();
    }
  });

  it('replaces the attached tab with the most recent one; a stale detach does not disconnect it', () => {
    const hub = new ControlHub(1000);
    const first: number[] = [];
    const second: number[] = [];
    const detachFirst = hub.attachClient((p) => first.push(p.id));
    hub.attachClient((p) => second.push(p.id));

    hub.submit({ command: 'x' }).catch(() => {});
    expect(first).toHaveLength(0); // replaced — no longer the relay target
    expect(second).toHaveLength(1);

    detachFirst(); // the OLD tab closing must not detach the new one
    expect(hub.hasClient()).toBe(true);
  });

  it('ignores unknown/duplicate/malformed responses without crashing the relay', () => {
    const hub = new ControlHub(1000);
    expect(hub.receiveResponse(null)).toBe(false);
    expect(hub.receiveResponse({ id: 'nope', ok: true })).toBe(false);
    expect(hub.receiveResponse({ id: 999, ok: true, result: 1 })).toBe(false);
  });

  it('dispose rejects pending callers so nothing hangs on a dead relay', async () => {
    const hub = new ControlHub(60_000);
    hub.attachClient(() => {});
    const pending = hub.submit({ command: 'slow' });
    vi.useFakeTimers();
    hub.dispose();
    vi.useRealTimers();
    await expect(pending).rejects.toThrow('Control relay shut down.');
    expect(hub.hasClient()).toBe(false);
  });
});
