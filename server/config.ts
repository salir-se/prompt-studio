import path from 'node:path';
import { type } from 'arktype';
import { STUDIO_DEV_ORIGINS } from '../src/bridge/fs-bridge';

/**
 * Standalone prompt-studio server configuration.
 *
 * Every value here is parsed once, at boot, from environment variables — never read ad hoc
 * from `process.env` elsewhere in the server code (see CLAUDE.md "Environment Configuration").
 * Validation runs through **arktype** (ADR-066): `STUDIO_CONFIG_SCHEMA` below is the single
 * boundary that accepts or rejects every `STUDIO_*`/`ZAI_*` variable this server reads, mirroring
 * the `validateEnvConfig`/`requireEnvConfig` pattern in `@prompt-studio/worker-http`'s `env.ts` (not reused
 * directly — that package is Workers-oriented and this is a plain Node/Bun process, so this
 * module carries its own small, arktype-native equivalent instead of adding a dependency).
 *
 * A malformed value throws `ConfigError` with a message that NAMES the offending variable but
 * never echoes its value: the value may be operator-controlled but is still untrusted input,
 * and printing it back would put arbitrary attacker-influenced text in the process's stdout/stderr.
 * `summarizeConfigErrors` enforces this by building messages ONLY from each arktype error's
 * `path` (which variable) and `expected` (what was wanted) — never `actual`/`message`/`summary`,
 * which arktype populates with the offending value for built-in keyword failures (verified: a
 * malformed `string.integer.parse` input echoes it into `actual`).
 */

/** Thrown by `resolveConfig` for a malformed environment variable. Message never contains a value. */
export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export interface StudioServerConfig {
  /** Absolute path to the repository the fs bridge reads from. */
  repoRoot: string;
  /** Absolute path to the directory holding the built SPA (resolved against the app root). */
  staticDir: string;
  /** Bind address. */
  host: string;
  /** Bind port. */
  port: number;
  /** Origins allowed to carry an `Origin` header into `/__studio/*` (see `validateOrigin`). */
  allowedOrigins: string[];
  /**
   * z.ai API key for `POST /verify`, read once at boot and held only in process memory —
   * `undefined` when unset, which is the normal "verification unavailable" degraded state, not a
   * boot failure (see `verify.ts`'s 503). NEVER log this field or serialize the config object
   * wholesale; every existing call site logs individual named fields for this exact reason.
   */
  zaiApiKey?: string;
  /** z.ai base URL override; `undefined` falls back to the provider registry's own default. */
  zaiBaseUrl?: string;
  /** Per-boot call budget for `POST /verify` (`STUDIO_VERIFY_BUDGET`, default 20). */
  verifyBudget: number;
  /**
   * Explicit operator override for the studio manifest's location (`STUDIO_MANIFEST_PATH`,
   * ADR-235). `undefined` = the default resolution chain (baked image copy, then the app-tree
   * file) — see `src/manifest/resolve-manifest.ts`. The path is kept raw here and resolved by
   * the resolver, not here: this module stays a pure env→config mapping.
   */
  manifestPath?: string;
  /** Operator-pinned control token (`STUDIO_CONTROL_TOKEN`) — the docker-hosted workflow (ADR-236). */
  controlToken?: string;
  /**
   * Where cloned prompt repositories are stored. Unset in normal use: the server
   * uses a folder under the person's home directory. Tests pass a temp directory.
   */
  promptRepoDir?: string;
  /** Public GitHub App client ID for browser device authorization. */
  githubClientId?: string;
}

/** Minimal subset of `process.env` this module reads — keeps `resolveConfig` testable without a real process. */
export type StudioServerEnv = Partial<
  Record<
    | 'STUDIO_REPO_ROOT'
    | 'STUDIO_STATIC_DIR'
    | 'STUDIO_HOST'
    | 'STUDIO_PORT'
    | 'STUDIO_ALLOWED_ORIGINS'
    | 'ZAI_API_KEY'
    | 'ZAI_BASE_URL'
    | 'STUDIO_VERIFY_BUDGET'
    | 'STUDIO_MANIFEST_PATH'
    | 'STUDIO_CONTROL_TOKEN'
    | 'STUDIO_GITHUB_CLIENT_ID',
    string
  >
>;

// Defaults for every STUDIO_* variable. STUDIO_ALLOWED_ORIGINS' default reuses fs-bridge's own
// STUDIO_DEV_ORIGINS constant rather than repeating the two origin strings — one source of truth
// for "what is the studio's own origin" whether the bridge runs under Vite or this standalone server.
const DEFAULT_REPO_ROOT = '/repo';
const DEFAULT_STATIC_DIR = './dist';
const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = '5273';
const DEFAULT_ALLOWED_ORIGINS = STUDIO_DEV_ORIGINS.join(',');
// ZAI_API_KEY/ZAI_BASE_URL have no default — genuinely optional, "unset" is a real, valid state.
const DEFAULT_VERIFY_BUDGET = '20';

/**
 * Splits a comma-separated origin list into trimmed, non-empty entries. Kept as a small, pure,
 * directly-testable helper and reused as the morph step inside `STUDIO_CONFIG_SCHEMA` below — the
 * schema's `.narrow()` is what turns an empty result into a rejection at the `resolveConfig`
 * boundary (see that schema's doc comment for why an empty result is no longer accepted there).
 */
export function parseAllowedOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter((origin) => origin.length > 0);
}

/**
 * Parses `STUDIO_PORT`. Throws `ConfigError` (naming the variable, never the value) if malformed.
 *
 * Retained standalone (permissive — port `0` is a valid whole number) for its existing unit
 * coverage; `resolveConfig` no longer calls this internally. Its arktype schema validates
 * `STUDIO_PORT` afresh via the `string.integer.parse` keyword plus a `1..65535` bound instead,
 * since the documented contract for the *server's own bind port* is stricter than "any whole
 * number" — 0 is meaningless as a bind port. See `STUDIO_CONFIG_SCHEMA`.
 */
export function parsePort(raw: string): number {
  const trimmed = raw.trim();
  if (!/^\d+$/.test(trimmed)) {
    throw new ConfigError('STUDIO_PORT must be a whole number between 0 and 65535.');
  }
  const value = Number(trimmed);
  if (value > 65535) {
    throw new ConfigError('STUDIO_PORT must be a whole number between 0 and 65535.');
  }
  return value;
}

/** `STUDIO_REPO_ROOT` must be absolute; morphs to its resolved (`.`/`..`-normalized) form. */
const repoRootType = type('string')
  .filter((raw, ctx) => path.isAbsolute(raw) || ctx.reject({ expected: 'an absolute path', actual: '' }))
  .pipe((raw) => path.resolve(raw));

/** `STUDIO_HOST` must not be empty (or all whitespace). */
const hostType = type('string').narrow(
  (host, ctx) => host.trim().length > 0 || ctx.reject({ expected: 'a non-empty value', actual: '' }),
);

/**
 * `STUDIO_PORT` must be a well-formed whole-number string (no sign, no decimal point — arktype's
 * `string.integer.parse` keyword rejects both, plus leading/trailing whitespace) naming a valid
 * bind port, `1..65535`. Unlike `parsePort` above, `0` is rejected: this is the server's own bind
 * port, and `0` cannot be listened on meaningfully in this context.
 */
const portType = type('string.integer.parse').narrow(
  (port, ctx) => (port >= 1 && port <= 65535) || ctx.reject({ expected: 'an integer from 1 to 65535', actual: '' }),
);

/**
 * `STUDIO_ALLOWED_ORIGINS` splits via `parseAllowedOrigins` and must resolve to at least one
 * origin. A prior revision of this module treated an explicitly-empty list as a valid
 * deny-all-cross-origin outcome; this schema tightens that at the `resolveConfig` boundary (an
 * operator-supplied empty allowlist is far more likely a misconfiguration than an intentional
 * lockdown, and fail-fast is the safer default) while `parseAllowedOrigins` itself stays
 * permissive for its own direct callers/tests.
 */
const allowedOriginsType = type('string')
  .pipe((raw) => parseAllowedOrigins(raw))
  .narrow((origins, ctx) => origins.length > 0 || ctx.reject({ expected: 'at least one allowed origin', actual: '' }));

/**
 * `ZAI_API_KEY` is a **secret** (see `.env.example`): presence-checked only — `'string > 0'`
 * rejects a blank value (e.g. an accidentally-set `ZAI_API_KEY=` in `.env`) but never inspects the
 * key's actual content, length, or prefix. An absent key is a normal "verification unavailable"
 * degraded state (`verify.ts`'s 503), not a boot-time failure, so this is an optional schema key
 * with no default rather than a required one.
 */
const zaiApiKeyType = type('string > 0');

/** `ZAI_BASE_URL` is optional and non-secret; blank is treated the same as unset (falls back to
 *  the provider registry's own default) rather than being accepted as a literal empty base URL. */
const zaiBaseUrlType = type('string > 0');

/**
 * `STUDIO_VERIFY_BUDGET` bounds how many `POST /verify` calls (hence z.ai token spend) this boot
 * will make — see `verify.ts`. Non-negative so `0` is a valid "verification always budget-exhausted"
 * operator override, unlike `STUDIO_PORT` where `0` is meaningless.
 */
const verifyBudgetType = type('string.integer.parse').narrow(
  (budget, ctx) => budget >= 0 || ctx.reject({ expected: 'a non-negative integer', actual: '' }),
);

/**
 * The arktype validation boundary for every `STUDIO_*`/`ZAI_*` variable this server reads
 * (ADR-066). Property keys are the env var names themselves, so an error's `path[0]` IS the
 * variable name — see `summarizeConfigErrors`. No `'+': 'reject'`: per CLAUDE.md's env-schema rule
 * this validates only the declared keys and leaves anything else on the input object untouched
 * (there is no runtime here injecting extra bindings, but the rule is followed for consistency
 * with every other env schema in the repo).
 */
const STUDIO_CONFIG_SCHEMA = type({
  STUDIO_REPO_ROOT: repoRootType,
  STUDIO_STATIC_DIR: 'string',
  STUDIO_HOST: hostType,
  STUDIO_PORT: portType,
  STUDIO_ALLOWED_ORIGINS: allowedOriginsType,
  STUDIO_VERIFY_BUDGET: verifyBudgetType,
  'ZAI_API_KEY?': zaiApiKeyType,
  'ZAI_BASE_URL?': zaiBaseUrlType,
  // Blank is rejected (a set-but-empty path is a misconfiguration), same optional-secret
  // semantics as ZAI_BASE_URL above; absent = default resolution chain.
  'STUDIO_MANIFEST_PATH?': 'string > 0',
  // Operator-set control-channel token for docker-hosted studios (ADR-236): a host-side
  // CLI/MCP client cannot read the CONTAINER's per-boot token file, so the operator pins a
  // token at `docker run -e STUDIO_CONTROL_TOKEN=…` and passes the same to the client. Absent
  // = per-boot random token published to the (in-container) token file. Blank is rejected —
  // a set-but-empty token is a misconfiguration that would silently disable auth comparisons.
  'STUDIO_CONTROL_TOKEN?': 'string > 0',
  'STUDIO_GITHUB_CLIENT_ID?': type('string').narrow((value) => /^[A-Za-z0-9_.-]{1,100}$/.test(value)),
});

/**
 * Turns arktype errors into one safe, stable, human-readable message: one `VAR_NAME: expected …`
 * clause per failing variable, deduped and sorted, joined for a single `ConfigError`. Deliberately
 * reads only `path` + `expected` — never `actual`/`message`/`summary`, which can embed the
 * offending value (see this module's doc comment).
 */
function summarizeConfigErrors(errors: type.errors): string {
  const lines = new Set<string>();
  for (const err of errors as Iterable<{ path?: PropertyKey[]; expected?: unknown }>) {
    const name = err.path && err.path.length > 0 ? String(err.path[0]) : '(root)';
    const expected = typeof err.expected === 'string' && err.expected.length > 0 ? err.expected : 'a valid value';
    lines.add(`${name}: expected ${expected}`);
  }
  return [...lines].sort().join('; ');
}

/**
 * Resolves every `STUDIO_*` environment variable into a `StudioServerConfig`, applying defaults
 * for anything unset. `appRoot` is the absolute path `STUDIO_STATIC_DIR` resolves against when
 * it's relative (the default `./dist` means "this app's own `dist/`", not the process's cwd) —
 * passed in explicitly, rather than computed here from `import.meta.url`, so this function stays
 * a pure, unit-testable mapping from inputs to a config object.
 */
export function resolveConfig(env: StudioServerEnv, appRoot: string): StudioServerConfig {
  const raw = {
    STUDIO_REPO_ROOT: env.STUDIO_REPO_ROOT ?? DEFAULT_REPO_ROOT,
    STUDIO_STATIC_DIR: env.STUDIO_STATIC_DIR ?? DEFAULT_STATIC_DIR,
    STUDIO_HOST: env.STUDIO_HOST ?? DEFAULT_HOST,
    STUDIO_PORT: env.STUDIO_PORT ?? DEFAULT_PORT,
    STUDIO_ALLOWED_ORIGINS: env.STUDIO_ALLOWED_ORIGINS ?? DEFAULT_ALLOWED_ORIGINS,
    STUDIO_VERIFY_BUDGET: env.STUDIO_VERIFY_BUDGET ?? DEFAULT_VERIFY_BUDGET,
    // Omitted entirely when unset (rather than coerced to an empty-string default like every
    // variable above) so the schema's optional-key semantics apply — "not configured" and
    // "configured as blank" must both land on the same 503-degraded verify.ts path.
    ...(env.ZAI_API_KEY !== undefined ? { ZAI_API_KEY: env.ZAI_API_KEY } : {}),
    ...(env.ZAI_BASE_URL !== undefined ? { ZAI_BASE_URL: env.ZAI_BASE_URL } : {}),
    ...(env.STUDIO_MANIFEST_PATH !== undefined ? { STUDIO_MANIFEST_PATH: env.STUDIO_MANIFEST_PATH } : {}),
    STUDIO_GITHUB_CLIENT_ID: env.STUDIO_GITHUB_CLIENT_ID ?? 'Iv23liSWVNoHWL8Onr5s',
    ...(env.STUDIO_CONTROL_TOKEN !== undefined ? { STUDIO_CONTROL_TOKEN: env.STUDIO_CONTROL_TOKEN } : {}),
  };

  const parsed = STUDIO_CONFIG_SCHEMA(raw);
  if (parsed instanceof type.errors) {
    throw new ConfigError(summarizeConfigErrors(parsed));
  }

  return {
    repoRoot: parsed.STUDIO_REPO_ROOT,
    staticDir: path.resolve(appRoot, parsed.STUDIO_STATIC_DIR),
    host: parsed.STUDIO_HOST,
    port: parsed.STUDIO_PORT,
    allowedOrigins: parsed.STUDIO_ALLOWED_ORIGINS,
    zaiApiKey: parsed.ZAI_API_KEY,
    zaiBaseUrl: parsed.ZAI_BASE_URL,
    verifyBudget: parsed.STUDIO_VERIFY_BUDGET,
    manifestPath: parsed.STUDIO_MANIFEST_PATH,
    controlToken: parsed.STUDIO_CONTROL_TOKEN,
    githubClientId: parsed.STUDIO_GITHUB_CLIENT_ID,
  };
}
