import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { resolveActiveManifest } from '../src/manifest/resolve-manifest';
import { createHttpServer } from './app';
import { standaloneAppRoot } from './compiled-root';
import { ConfigError, resolveConfig, type StudioServerEnv } from './config';
import { ControlHub } from './control-hub';
import { createControlRoutes } from './control-routes';
import { defaultControlTokenDir, removeControlTokenFile, writeControlTokenFile } from './control-token-file';

/**
 * Standalone production entry point for prompt-studio: serves the built SPA (`STUDIO_STATIC_DIR`)
 * and the read-only `/__studio/*` filesystem bridge over plain HTTP, configured entirely by
 * `STUDIO_*` environment variables (see `server/config.ts`). Superseding ADR-202, which described
 * the bridge as Vite-dev-only — it's a `configureServer` plugin hook with no equivalent in a
 * production build, hence this standalone process for the Docker image — and, since the ADR-204
 * npm-package amendment, for the `@salir-se/prompt-studio` launchers under `bin/`.
 *
 * This file is intentionally the thin shell: config parsing lives in `config.ts`, HTTP routing and
 * bridge/static dispatch lives in `app.ts`. Nothing here is unit tested directly — there is no
 * decision logic to test, only process wiring (env → config → listen).
 */

// apps/prompt-studio (this file's directory's parent) — STUDIO_STATIC_DIR's default ('./dist')
// resolves against this, not against the process's cwd, so the server behaves the same
// regardless of where it's launched from. The bundled npm package reproduces this shape
// (`<package>/server/main.js` → app root is the package root, `dist/` sits beside it).
// A compiled binary embeds those files under `/$bunfs/root`, or `B:\~BUN\root` on Windows
// (see compiled-root.ts).
const appRoot = standaloneAppRoot(import.meta.url);

/**
 * Fallbacks a launcher (the npm package's `bin/prompt-studio.js`) can layer UNDER the real
 * environment: each is used only where the corresponding `STUDIO_*` variable is unset, so an
 * operator's explicit environment always wins. The container does NOT use this mechanism — its
 * defaults come from the Dockerfile's own ENV block — and `config.ts`'s defaults are unchanged.
 */
export interface StandaloneServerEnvDefaults {
  STUDIO_REPO_ROOT?: string;
  STUDIO_STATIC_DIR?: string;
  STUDIO_HOST?: string;
  STUDIO_PORT?: string;
  STUDIO_ALLOWED_ORIGINS?: string;
}

export interface StandaloneServerOptions {
  /** Applied only where `env` leaves the corresponding `STUDIO_*` variable unset. */
  envDefaults?: StandaloneServerEnvDefaults;
  /**
   * Manifest used when `STUDIO_MANIFEST_PATH` is unset — the npm package points this at its
   * shipped `studio-manifest/manifest.json` copy. The env override keeps precedence (see
   * resolve-manifest.ts's resolution chain).
   */
  defaultManifestPath?: string;
}

/**
 * Boots the standalone server. Returns once the listener is registered (the process stays alive
 * on the open handle until SIGINT/SIGTERM); a malformed environment sets exit code 1 and resolves
 * without listening (the ConfigError message names the variable, never its value).
 */
export async function runStandaloneServer(
  env: StudioServerEnv = process.env,
  options: StandaloneServerOptions = {},
): Promise<void> {
  const defaults = options.envDefaults ?? {};
  const effectiveEnv: StudioServerEnv = {
    STUDIO_REPO_ROOT: env.STUDIO_REPO_ROOT ?? defaults.STUDIO_REPO_ROOT,
    STUDIO_STATIC_DIR: env.STUDIO_STATIC_DIR ?? defaults.STUDIO_STATIC_DIR,
    STUDIO_HOST: env.STUDIO_HOST ?? defaults.STUDIO_HOST,
    STUDIO_PORT: env.STUDIO_PORT ?? defaults.STUDIO_PORT,
    STUDIO_ALLOWED_ORIGINS: env.STUDIO_ALLOWED_ORIGINS ?? defaults.STUDIO_ALLOWED_ORIGINS,
    ZAI_API_KEY: env.ZAI_API_KEY,
    ZAI_BASE_URL: env.ZAI_BASE_URL,
    STUDIO_VERIFY_BUDGET: env.STUDIO_VERIFY_BUDGET,
    STUDIO_MANIFEST_PATH: env.STUDIO_MANIFEST_PATH,
    STUDIO_CONTROL_TOKEN: env.STUDIO_CONTROL_TOKEN,
    STUDIO_GITHUB_CLIENT_ID: env.STUDIO_GITHUB_CLIENT_ID,
  };

  let config: ReturnType<typeof resolveConfig>;
  try {
    config = resolveConfig(effectiveEnv, appRoot);
  } catch (error) {
    // ConfigError messages name the offending variable but never its value (see config.ts).
    console.error(error instanceof ConfigError ? error.message : error);
    process.exitCode = 1;
    return;
  }

  // Manifest resolution (ADR-235) happens once at boot, not per request: env override
  // (`STUDIO_MANIFEST_PATH`) > launcher default (the npm package's shipped copy) / baked image
  // copy (`/studio-manifest/manifest.json`) > the app-tree checked-in file. An INVALID manifest
  // never blocks the boot — the reason is logged here, `/__studio/manifest` answers 500 so the
  // operator sees it, and the bridge falls back to the shipped default allowlist (see
  // resolve-manifest.ts).
  const resolvedManifest = await resolveActiveManifest({
    appRoot,
    manifestPath: config.manifestPath ?? options.defaultManifestPath,
  });
  if (resolvedManifest.status !== 'ok') {
    console.error(`[prompt-studio server] active manifest is invalid — ${resolvedManifest.detail}`);
  }

  // Per-boot token: freshly generated on every process start, kept only in memory, and NEVER
  // logged — logging it would defeat the entire reason it's injected into index.html at request
  // time instead of being baked into the published image (see html.ts's doc comment).
  // Operator-pinned (docker: `STUDIO_CONTROL_TOKEN`) or per-boot random — see config.ts's
  // schema note for why the pinned form exists (host-side CLI/MCP clients cannot read the
  // container's token file).
  const token = config.controlToken ?? randomUUID();

  // Control channel (ADR-236): the CLI/MCP relay. The per-boot token is published to the
  // port-scoped, 0600 temp file local clients read (control-token-file.ts); removed on shutdown.
  const control = await createControlRoutes(new ControlHub(), token, writeControlTokenFile, removeControlTokenFile, {
    tokenDir: defaultControlTokenDir(),
    port: config.port,
    allowedOrigins: config.allowedOrigins,
  });

  const server = createHttpServer(config, token, resolvedManifest, control);
  server.listen(config.port, config.host, () => {
    console.log(`prompt-studio server listening on http://${config.host}:${config.port}`);
  });
  const shutdown = (): void => {
    void control.dispose().finally(() => server.close(() => process.exit(0)));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

// Only boot the server when this file is executed directly (`bun server/main.ts` / the Docker
// CMD) — not when a launcher (the npm package's bin) imports `runStandaloneServer`, which then
// boots explicitly with its own defaults layered in, and which would otherwise start a second
// listener racing the first for the configured port.
const invokedPath = process.argv[1] ?? '';
const modulePath = fileURLToPath(import.meta.url);
const isServerMain =
  invokedPath.endsWith(`${path.sep}server${path.sep}main.ts`) ||
  invokedPath.endsWith(`${path.sep}server${path.sep}main.js`);
const isEntryPoint = invokedPath === modulePath && isServerMain;
if (isEntryPoint) {
  void runStandaloneServer();
}
