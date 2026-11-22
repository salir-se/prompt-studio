// @module-tag dom
// Safe-fallback contract of the CMS content hook (ADR-095): flag off ⇒ no
// fetch; success ⇒ merged registry; any failure ⇒ bundled content untouched.

import { renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { HelpContent } from '../core/types';
import { useRemoteHelpContent } from './useRemoteHelpContent';

const base: HelpContent = {
  pages: { Scout: { pageLabel: 'Scout', faq: [{ id: 'scout.what', question: 'Q', answer: 'Bundled.' }] } },
};

const remotePayload = {
  surface: 'app',
  generatedAt: '2026-06-10T00:00:00Z',
  pages: { Scout: { pageLabel: 'Scout', faq: [{ id: 'scout.what', question: 'Q', answer: 'CMS.' }] } },
};

function fetchOk(body: unknown): typeof fetch {
  return vi.fn(async () => new Response(JSON.stringify(body), { status: 200 })) as unknown as typeof fetch;
}

afterEach(() => {
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe('useRemoteHelpContent', () => {
  it('returns the bundled content and never fetches when the flag is off', async () => {
    const fetchImpl = fetchOk(remotePayload);
    const { result } = renderHook(() =>
      useRemoteHelpContent({
        base,
        surface: 'app',
        endpoint: 'https://auth.test/api/help/content/app',
        enabled: false,
        fetchImpl,
      }),
    );
    expect(result.current).toBe(base);
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('merges the remote payload after a successful fetch and caches it', async () => {
    const fetchImpl = fetchOk(remotePayload);
    const { result } = renderHook(() =>
      useRemoteHelpContent({
        base,
        surface: 'app',
        endpoint: 'https://auth.test/api/help/content/app',
        enabled: true,
        fetchImpl,
      }),
    );
    expect(result.current).toBe(base); // synchronous first paint = bundled
    await waitFor(() => expect(result.current.pages.Scout.faq[0].answer).toBe('CMS.'));
    expect(sessionStorage.getItem('salir:help-cms:app')).toContain('CMS.');
  });

  it('keeps the bundled content on a non-200 response', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = vi.fn(async () => new Response('nope', { status: 503 })) as unknown as typeof fetch;
    const { result } = renderHook(() =>
      useRemoteHelpContent({ base, surface: 'app', endpoint: 'https://auth.test/x', enabled: true, fetchImpl }),
    );
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(result.current).toBe(base);
  });

  it('keeps the bundled content on a malformed payload', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchImpl = fetchOk({ totally: 'wrong' });
    const { result } = renderHook(() =>
      useRemoteHelpContent({ base, surface: 'app', endpoint: 'https://auth.test/x', enabled: true, fetchImpl }),
    );
    await waitFor(() => expect(warn).toHaveBeenCalled());
    expect(result.current).toBe(base);
  });

  it('warm-starts from a fresh sessionStorage entry without refetching', async () => {
    sessionStorage.setItem('salir:help-cms:app', JSON.stringify({ payload: remotePayload, fetchedAt: Date.now() }));
    const fetchImpl = fetchOk(remotePayload);
    const { result } = renderHook(() =>
      useRemoteHelpContent({ base, surface: 'app', endpoint: 'https://auth.test/x', enabled: true, fetchImpl }),
    );
    expect(result.current.pages.Scout.faq[0].answer).toBe('CMS.');
    await new Promise((r) => setTimeout(r, 10));
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('refetches when the cached entry is older than the TTL', async () => {
    sessionStorage.setItem(
      'salir:help-cms:app',
      JSON.stringify({ payload: remotePayload, fetchedAt: Date.now() - 10 * 60 * 1000 }),
    );
    const fresh = {
      ...remotePayload,
      pages: { Scout: { pageLabel: 'Scout', faq: [{ id: 'scout.what', question: 'Q', answer: 'Fresh.' }] } },
    };
    const fetchImpl = fetchOk(fresh);
    const { result } = renderHook(() =>
      useRemoteHelpContent({ base, surface: 'app', endpoint: 'https://auth.test/x', enabled: true, fetchImpl }),
    );
    await waitFor(() => expect(result.current.pages.Scout.faq[0].answer).toBe('Fresh.'));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
