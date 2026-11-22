/**
 * Axiom console link builders — org id + dashboard uid, ONE per environment. Single source of
 * truth for `apps/logs-cli`'s `dashboardUrl`/`monitorsUrl` and `services/notify`'s Axiom→Telegram
 * alert formatter, which each used to hardcode their own copy of these constants.
 *
 * ONE Axiom account, TWO organizations: staging and production used to share `artfulbits-it-ab-
 * knm4`, and are moving to separate orgs so a runaway staging query can't touch production's
 * ingest/query budget. `artfulbits-it-ab-knm4` stays staging's org; `salir-ab-a5za` is the new
 * production-only org.
 *
 * The environment key here is a plain structural union, not imported from either consumer's own
 * type (`apps/logs-cli`'s `LogsEnvironment`, `services/notify`'s `AxiomAlertEnvironment`) — both
 * are already `'staging' | 'production'`, so neither package needs to import the other's type to
 * use this module.
 */

/** Deployment tiers the Axiom console link builders understand. */
export type AxiomConsoleEnvironment = 'staging' | 'production';

/** Axiom organization id per environment — the `app.axiom.co/<org>/...` path segment. */
export const AXIOM_ORG_ID: Record<AxiomConsoleEnvironment, string> = {
  staging: 'artfulbits-it-ab-knm4',
  production: 'salir-ab-a5za',
};

/**
 * Dashboard UID per environment (`infra/axiom`) — the "what is erroring right now" view a human
 * opens after reading a digest or alert. This is the console-URL id, distinct from `infra/axiom`'s
 * declared `uid` (e.g. `salir-workers-production`): that `uid` is ours and Axiom does honor it, but
 * the `app.axiom.co/<org>/dashboards/<id>` path uses Axiom's own generated `id`, not our `uid`.
 *
 * Recreating a dashboard under a new org therefore yields a NEW console id even though our `uid`
 * is unchanged. `staging` still lives under the shared `artfulbits-it-ab-knm4` org (imported, not
 * recreated); `production` was recreated under `salir-ab-a5za` (2026-08-20). Refresh the affected
 * entry from the Axiom API or `tofu output -json dashboard_ids` after any dashboard is (re)created
 * in a new org; do not invent placeholder values in the meantime.
 */
export const AXIOM_DASHBOARD_UID: Record<AxiomConsoleEnvironment, string> = {
  staging: 'Wn8g8VQxC0mGXy0JN0',
  production: 'OShAtxEubQ5nAbU08n',
};

/** The env-scoped Axiom dashboard URL. */
export function axiomDashboardUrl(environment: AxiomConsoleEnvironment): string {
  return `https://app.axiom.co/${AXIOM_ORG_ID[environment]}/dashboards/${AXIOM_DASHBOARD_UID[environment]}`;
}

/** The env-scoped Axiom monitors list — env-scoped because each environment now has its own org,
 *  so staging and production monitors no longer live behind the same URL. */
export function axiomMonitorsUrl(environment: AxiomConsoleEnvironment): string {
  return `https://app.axiom.co/${AXIOM_ORG_ID[environment]}/monitors`;
}
