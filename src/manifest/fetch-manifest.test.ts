// @module-tag dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_MANIFEST } from './default-manifest';
import { fetchActiveManifest, fetchManifestFileTexts, manifestFileSourcePaths } from './fetch-manifest';

/**
 * The manifest client's degrade-vs-adopt boundary: the server already validated the manifest it
 * serves, but the response crosses the network to get here, so the SPA re-validates with the
 * same schema and falls back to the shipped manifest on ANY failure — the studio must keep
 * working (on the salir catalog) rather than render a third-party tree it cannot trust.
 */

const STUDIO_TOKEN_HEADER = 'x-studio-token';

function setStudioToken(token = 'test-token'): void {
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'studio-token');
  meta.setAttribute('content', token);
  document.head.appendChild(meta);
}

function jsonResponse(status: number, body: unknown): Response {
  return { ok: status >= 200 && status < 300, status, json: async () => body } as unknown as Response;
}

const THIRD_PARTY = {
  schemaVersion: 1,
  name: 'third-party',
  contentRoots: ['vendor/prompts'],
  skillsRoot: 'vendor/skills',
  exportRoot: 'vendor/prompts',
  catalog: {
    source: 'explicit',
    documents: [{ id: 'greeter', title: 'Greeter', source: { kind: 'file', path: 'vendor/prompts/greeter.md' } }],
  },
  baselines: [
    { id: 'default', label: 'Default', description: 'Shipped.', positioning: 'shipped', source: { kind: 'shipped' } },
  ],
};

afterEach(() => {
  for (const meta of document.head.querySelectorAll('meta[name="studio-token"]')) {
    meta.remove();
  }
  vi.unstubAllGlobals();
});

describe('fetchActiveManifest', () => {
  it('returns the shipped manifest without fetching when no studio token exists (vitest, no dev server)', async () => {
    expect(await fetchActiveManifest()).toBe(DEFAULT_MANIFEST);
  });

  it('degrades to the shipped manifest on a non-2xx response', async () => {
    setStudioToken();
    const fetchMock = vi.fn(async () => jsonResponse(500, { ok: false }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchActiveManifest()).toBe(DEFAULT_MANIFEST);
  });

  it('degrades on a schema-invalid manifest — the SPA re-validates what the network returned', async () => {
    setStudioToken();
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => jsonResponse(200, { ok: true, manifest: { ...THIRD_PARTY, surprise: 1 } })),
    );
    expect(await fetchActiveManifest()).toBe(DEFAULT_MANIFEST);
  });

  it('adopts a valid third-party manifest', async () => {
    setStudioToken();
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe('/__studio/manifest');
      expect((init?.headers as Record<string, string> | undefined)?.[STUDIO_TOKEN_HEADER]).toBeTruthy();
      return jsonResponse(200, { ok: true, manifest: THIRD_PARTY });
    });
    vi.stubGlobal('fetch', fetchMock);
    const manifest = await fetchActiveManifest();
    expect(manifest.name).toBe('third-party');
    expect(manifest.catalog).toMatchObject({ source: 'explicit' });
  });
});

describe('manifestFileSourcePaths + fetchManifestFileTexts', () => {
  it('collects file-source paths from the explicit catalog and extraDocuments, deduped', () => {
    const manifest = {
      ...THIRD_PARTY,
      extraDocuments: [
        { id: 'extra', title: 'Extra', source: { kind: 'file', path: 'vendor/prompts/greeter.md' } },
        { id: 'sym', title: 'Sym', source: { kind: 'symbol', module: 'vendor/prompts/x.ts', symbol: 'X_PROMPT' } },
      ],
    };
    expect(manifestFileSourcePaths(manifest as never)).toEqual(['vendor/prompts/greeter.md']);
  });

  it('fetches each declared file once, keyed by path, and skips failures per-file', async () => {
    setStudioToken();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.searchParams.get('path') === 'vendor/prompts/greeter.md') {
        return jsonResponse(200, { ok: true, text: '# Greeter\n' });
      }
      return jsonResponse(404, { ok: false });
    });
    vi.stubGlobal('fetch', fetchMock);
    const texts = await fetchManifestFileTexts(THIRD_PARTY as never);
    expect(texts.get('vendor/prompts/greeter.md')).toBe('# Greeter\n');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns an empty map with no token — no fetch attempts', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect(await fetchManifestFileTexts(THIRD_PARTY as never)).toEqual(new Map());
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
