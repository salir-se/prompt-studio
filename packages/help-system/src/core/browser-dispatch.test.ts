// @module-tag dom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createBrowserDispatch } from './browser-dispatch';

beforeEach(() => {
  document.body.innerHTML = '';
});

describe('createBrowserDispatch', () => {
  it('routes highlight_region to the handler and acks with the resolved help ids', async () => {
    document.body.innerHTML = '<div data-help-id="a"></div><div data-help-id="b"></div>';
    const highlight = vi.fn();
    const dispatch = createBrowserDispatch({ highlight_region: highlight });
    const ack = await dispatch('highlight_region', { help_ids: ['a', 'b'], label: 'x' });
    expect(highlight).toHaveBeenCalledWith({ helpIds: ['a', 'b'], label: 'x', intent: undefined });
    expect(ack).toEqual({ ok: true, highlighted: ['a', 'b'] });
  });

  it('refuses highlight_region when NO id resolves — no dim, and the model learns which ids are missing', async () => {
    const highlight = vi.fn();
    const dispatch = createBrowserDispatch({ highlight_region: highlight });
    const ack = (await dispatch('highlight_region', { help_ids: ['nav.Ghost'] })) as Record<string, unknown>;
    expect(highlight).not.toHaveBeenCalled();
    expect(ack.ok).toBe(false);
    expect(ack.missing).toEqual(['nav.Ghost']);
  });

  it('highlights the resolvable subset and reports the rest as missing', async () => {
    document.body.innerHTML = '<div data-help-id="a"></div>';
    const highlight = vi.fn();
    const dispatch = createBrowserDispatch({ highlight_region: highlight });
    const ack = await dispatch('highlight_region', { help_ids: ['a', 'gone'] });
    expect(highlight).toHaveBeenCalledTimes(1);
    expect(ack).toEqual({ ok: true, highlighted: ['a'], missing: ['gone'] });
  });

  it('refuses scroll_to for an id that does not exist on the page', async () => {
    const scroll = vi.fn();
    const dispatch = createBrowserDispatch({ scroll_to: scroll });
    const ack = (await dispatch('scroll_to', { help_id: 'gone' })) as Record<string, unknown>;
    expect(scroll).not.toHaveBeenCalled();
    expect(ack.ok).toBe(false);
  });

  it.each(['start_tour', 'navigate'] as const)(
    '#2713: reports rejected or unavailable %s rather than success',
    async (name) => {
      const input = name === 'navigate' ? { page_key: 'Ghost' } : { tour_id: 'A human title' };
      const dispatch = createBrowserDispatch({ [name]: () => false });
      expect(await dispatch(name, input)).toMatchObject({ ok: false });
      expect(await createBrowserDispatch({})(name, input)).toMatchObject({ ok: false });
    },
  );

  it('awaits verify_step and returns the boolean result', async () => {
    const dispatch = createBrowserDispatch({ verify_step: async () => true });
    expect(await dispatch('verify_step', { check_id: 'scout.done' })).toEqual({
      ok: true,
      check_id: 'scout.done',
      passed: true,
    });
  });

  it('forwards unknown tools to the fallback', async () => {
    const fallback = vi.fn(async () => ({ ok: true, data: 1 }));
    const dispatch = createBrowserDispatch({}, fallback);
    await dispatch('get_data', { x: 1 });
    expect(fallback).toHaveBeenCalledWith('get_data', { x: 1 }, undefined);
  });

  it('errors on an unknown tool with no fallback (never silently mutates)', async () => {
    const dispatch = createBrowserDispatch({});
    expect(await dispatch('save_lead', {})).toEqual({ ok: false, error: 'unknown UI tool: save_lead' });
  });

  it('tolerates malformed input (missing help_ids)', async () => {
    const highlight = vi.fn();
    const dispatch = createBrowserDispatch({ highlight_region: highlight });
    await dispatch('highlight_region', {});
    expect(highlight).toHaveBeenCalledWith({ helpIds: [], label: undefined, intent: undefined });
  });
});
