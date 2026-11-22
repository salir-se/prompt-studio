import { type } from 'arktype';
import { DEFAULT_MANIFEST } from './default-manifest';
import { type StudioManifestParsed, validateStudioManifest } from './manifest-schema';

/**
 * Browser-side manifest client (ADR-235): fetches the ACTIVE manifest from
 * `GET /__studio/manifest` — the one the server resolved (env override > baked copy > app tree)
 * and validated at boot — and validates it AGAIN with the same schema, because the response
 * crosses another trust boundary (the network) before it drives the SPA's catalog, picker, and
 * skills root.
 *
 * Degrade, never die: any failure (no token, no fetch, non-2xx, malformed body, schema-invalid
 * manifest) falls back to the shipped `DEFAULT_MANIFEST` with a console.warn. The studio keeps
 * working on the salir catalog; a third-party operator sees the fallback in the log instead of a
 * blank app. This is the same posture as every other bridge client in this app
 * (bridge-content-source, baseline-content-source, skill-catalog).
 *
 * Browser-safe by construction: no node imports, and `x-studio-token` is duplicated as a local
 * constant rather than imported from fs-bridge.ts (see bridge-content-source.ts's module doc for
 * why that module must never enter the SPA bundle).
 */

const STUDIO_TOKEN_HEADER = 'x-studio-token';

function readStudioToken(): string | null {
  if (typeof document === 'undefined') return null;
  return document.querySelector('meta[name="studio-token"]')?.getAttribute('content') ?? null;
}

interface ManifestResponseBody {
  ok?: boolean;
  manifest?: unknown;
}

/**
 * Every file-sourced document path the manifest declares (explicit catalog + extraDocuments) —
 * file sources are the third-party pattern (`.md` prompt files), and their text can only come
 * from the bridge, in dev AND container alike.
 */
export function manifestFileSourcePaths(manifest: StudioManifestParsed): string[] {
  const documents =
    manifest.catalog.source === 'explicit'
      ? [...manifest.catalog.documents, ...(manifest.extraDocuments ?? [])]
      : (manifest.extraDocuments ?? []);
  const paths = new Set<string>();
  for (const document of documents) {
    if (document.source.kind === 'file') {
      paths.add(document.source.path);
    }
  }
  return [...paths];
}

/**
 * Fetches the declared file sources' texts, keyed by path. Per-file degrade: a file that cannot
 * be fetched simply has no entry, and its document renders `external` (visible, uneditable)
 * rather than broken — the same "skip, never crash" posture as skill loading.
 */
export async function fetchManifestFileTexts(manifest: StudioManifestParsed): Promise<Map<string, string>> {
  const texts = new Map<string, string>();
  if (typeof fetch !== 'function') return texts;
  const token = readStudioToken();
  if (!token) return texts;
  await Promise.all(
    manifestFileSourcePaths(manifest).map(async (path) => {
      try {
        const response = await fetch(`/__studio/file?path=${encodeURIComponent(path)}`, {
          headers: { [STUDIO_TOKEN_HEADER]: token },
        });
        if (!response.ok) return;
        const body = (await response.json()) as { ok?: boolean; text?: string };
        if (body.ok && typeof body.text === 'string') {
          texts.set(path, body.text);
        }
      } catch {
        // Per-file degrade — see the doc comment.
      }
    }),
  );
  return texts;
}

/**
 * The manifest the SPA should build itself from. Without a studio token or a reachable bridge
 * (vitest, a stale static export) this is always `DEFAULT_MANIFEST` — which is exactly the
 * pre-fetch behavior, so dev/test rendering is unchanged unless a token + manifest exist.
 */
export async function fetchActiveManifest(): Promise<StudioManifestParsed> {
  try {
    if (typeof fetch !== 'function') return DEFAULT_MANIFEST;
    const token = readStudioToken();
    if (!token) return DEFAULT_MANIFEST;
    const response = await fetch('/__studio/manifest', { headers: { [STUDIO_TOKEN_HEADER]: token } });
    if (!response.ok) {
      console.warn(`[fetch-manifest] /__studio/manifest responded ${response.status} — using the shipped manifest`);
      return DEFAULT_MANIFEST;
    }
    const body = (await response.json()) as ManifestResponseBody;
    if (!body.ok) {
      console.warn('[fetch-manifest] manifest endpoint returned an error body — using the shipped manifest');
      return DEFAULT_MANIFEST;
    }
    const parsed = validateStudioManifest(body.manifest);
    if (parsed instanceof type.errors) {
      // Never echo the manifest itself into the log — the errors name the offending fields.
      console.warn(
        `[fetch-manifest] active manifest failed validation — using the shipped manifest (${parsed.summary})`,
      );
      return DEFAULT_MANIFEST;
    }
    return parsed;
  } catch (error) {
    console.warn('[fetch-manifest] failed to load the active manifest — using the shipped manifest', error);
    return DEFAULT_MANIFEST;
  }
}
