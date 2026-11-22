/**
 * Axiom dataset naming convention: one dataset per deployment tier, so
 * staging noise never mixes with production signal in the same view.
 */

/**
 * Axiom is region-pinned per dataset. The `salir-logs-*` datasets live in
 * `eu-central-1` (ADR-241), and Axiom REJECTS ingest for them on the global
 * API host — `POST https://api.axiom.co/v1/logs` answers `400 mismatched
 * region` — so every INGEST path (worker tee, BFF relay, logs-cli smoke,
 * Cloudflare Logpush) must target the edge deployment domain. Management and
 * APL query stay on the global host (the edge 404s `/v1/datasets/_apl`).
 * Verified live 2026-08-18 during the bootstrap; `AXIOM_BASE_URL` overrides
 * the ingest host only.
 */
export const AXIOM_INGEST_BASE_URL = 'https://eu-central-1.aws.edge.axiom.co';
/** Global API host: dataset management, tokens, and APL query. Never ingest. */
export const AXIOM_API_BASE_URL = 'https://api.axiom.co';

const DATASET_BY_ENVIRONMENT: Record<string, string> = {
  production: 'salir-logs-production',
};

const DEFAULT_DATASET = 'salir-logs-staging';
const DEFAULT_TRACES_DATASET = 'salir-traces-staging';

/**
 * Resolve the Axiom dataset for an environment name.
 * A trimmed, non-empty `override` always wins (explicit config beats the
 * convention). Otherwise: 'production' -> production dataset; everything
 * else ('staging', 'preview', 'local', 'dev', 'test', undefined, or any
 * unknown name) -> the staging dataset (there is no `local` dataset —
 * removed 2026-08-19, ADR-241 amendment: it had no consumer, and a dev who
 * deliberately seals a staging ingest token ships to staging — nobody ships
 * by default, since no worker holds an Axiom token locally).
 */
export function axiomDatasetForEnvironment(environment: string | undefined, override?: string): string {
  const trimmedOverride = override?.trim();
  if (trimmedOverride) return trimmedOverride;
  if (!environment) return DEFAULT_DATASET;
  return DATASET_BY_ENVIRONMENT[environment] ?? DEFAULT_DATASET;
}

/** Resolve the ADR-254 traces dataset; previews and local development share staging. */
export function axiomTracesDatasetForEnvironment(environment: string | undefined): string {
  return environment === 'production' ? 'salir-traces-production' : DEFAULT_TRACES_DATASET;
}
