import { isPublished } from './governance';
import type { FaqItem } from './types';

/** Host-supplied resolvers that gate FAQ visibility (feature flags + A/B variants). */
export interface FaqGateResolvers {
  /** Whether a boolean feature flag is enabled (resolved by the host). */
  featureFlag?: (key: string) => boolean;
  /** The active A/B variant for an experiment key (resolved by the host). */
  getVariant?: (key: string) => string | undefined;
  /** Clock for the governance (G9) publish/expiry check; defaults to now. */
  now?: Date;
}

/**
 * Drop FAQ items that fail a `hidden`, `flag`, `experiment`, or governance gate.
 *
 * - `hidden: true` is always dropped.
 * - `flag` is dropped unless `featureFlag(flag)` returns true (default: dropped).
 * - `experiment` is dropped unless `getVariant(key)` equals the item's `variant`.
 * - governance (G9): dropped unless `meta` is published and not past `expiresAt`
 *   (absent `meta` ⇒ published, so existing content is unaffected).
 *
 * Pure and framework-agnostic; the host injects the resolvers.
 */
export function filterFaq(items: FaqItem[], resolvers: FaqGateResolvers = {}): FaqItem[] {
  const { featureFlag, getVariant, now } = resolvers;
  return items.filter((item) => {
    if (item.hidden) return false;
    if (!isPublished(item.meta, now)) return false;
    if (item.flag && !(featureFlag?.(item.flag) ?? false)) return false;
    if (item.experiment && getVariant?.(item.experiment.key) !== item.experiment.variant) return false;
    return true;
  });
}
