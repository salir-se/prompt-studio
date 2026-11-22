/**
 * Composite provider rootKeys for variant-qualified documents (ADR-235).
 *
 * ADR-203's `HistoryProvider` namespaces roots by one flat opaque string. Resolver-variant roots
 * (the Critic outbound V1/V2/Neutral pickers) previously had NO history at all — the provider
 * could not distinguish "critic-outbound-agent-loop@CRITIC_PROMPT" from
 * "critic-outbound-agent-loop@CRITIC_PROMPT_V2" if both committed under the bare root id. This
 * helper is the single place that keying lives, so commits, heads, history reads, and baseline
 * seeding all derive the same string. Existing snapshots keep their bare-id commits (plain keys
 * for constant roots are unchanged); variant keys are new data alongside them.
 */

/** `'rootId'` for the shipped/default variant, `'rootId@VARIANT_SYMBOL'` for a picked variant. */
export function providerKeyFor(rootId: string, variantSymbol?: string): string {
  return variantSymbol === undefined ? rootId : `${rootId}@${variantSymbol}`;
}
