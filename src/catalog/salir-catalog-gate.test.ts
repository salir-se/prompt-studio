// @module-tag dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { installedCatalogSkipsSalirSources, usesSalirSourceTree } from './salir-catalog-gate';

function setStudioToken(): void {
  const meta = document.createElement('meta');
  meta.name = 'studio-token';
  meta.content = 'test-token';
  document.head.appendChild(meta);
}

afterEach(() => {
  document.querySelector('meta[name="studio-token"]')?.remove();
  vi.unstubAllGlobals();
});

describe('installedCatalogSkipsSalirSources', () => {
  it('recognises the Salir source tree', () => {
    expect(usesSalirSourceTree(['packages/prompts', 'packages/skills/skills', 'docs/prompts'])).toBe(true);
    expect(usesSalirSourceTree(['prompts', 'skills'])).toBe(false);
  });

  it("skips Salir source files when the catalog is the person's prompt folder", async () => {
    setStudioToken();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL) => ({
      ok: true,
      json: async () => ({ ok: true, manifest: { contentRoots: ['prompts', 'skills'] } }),
    }));
    vi.stubGlobal('fetch', fetchImpl);

    expect(await installedCatalogSkipsSalirSources()).toBe(true);
    expect(String(fetchImpl.mock.calls[0]?.[0])).toBe('/__studio/manifest');
  });

  it('keeps Salir source files when the catalog is the Salir checkout', async () => {
    setStudioToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({
          ok: true,
          manifest: { contentRoots: ['packages/prompts', 'packages/skills/skills', 'docs/prompts'] },
        }),
      })),
    );

    expect(await installedCatalogSkipsSalirSources()).toBe(false);
  });
});
