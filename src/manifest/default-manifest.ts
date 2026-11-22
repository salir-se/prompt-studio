import { type } from 'arktype';
import { type StudioManifestParsed, validateStudioManifest } from './manifest-schema';
import defaultManifestJson from './default.manifest.json';

/**
 * The bundled default manifest — the checked-in `default.manifest.json`, validated at module load.
 *
 * This file is the single source of truth for the studio's baked editor configuration: the Docker
 * image ships a byte-identical copy at `/studio-manifest/manifest.json` (see
 * `infra/docker/prompt-studio.Dockerfile`), the standalone server and the Vite dev plugin resolve
 * the ACTIVE manifest from disk (`resolve-manifest.ts`) and serve it at `GET /__studio/manifest`,
 * and this module is the SPA's last-resort fallback when the endpoint is unavailable or its
 * manifest is invalid. Baking this file is ADR-204-compatible precisely because it is metadata
 * only — no prompt prose (see `manifest-schema.ts`'s module doc).
 *
 * The module-load validation is a fail-fast on OURSELVES, not on operator input: if this checked-in
 * file ever drifts out of schema, the dev server and every test importing the studio fail loudly
 * at startup instead of shipping a broken manifest into the image.
 */
const parsed = validateStudioManifest(defaultManifestJson);
if (parsed instanceof type.errors) {
  // Message names the offending fields (arktype error paths) but never echoes values — same
  // discipline as config.ts's summarizeConfigErrors, and for the same reason.
  const fields = [...parsed]
    .map((error) => (error.path.length > 0 ? String(error.path[0]) : '(root)'))
    .sort()
    .join(', ');
  throw new Error(`default.manifest.json failed schema validation at: ${fields}`);
}

export const DEFAULT_MANIFEST: StudioManifestParsed = parsed;
