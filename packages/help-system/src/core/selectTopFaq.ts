import { type FaqGateResolvers, filterFaq } from './filterFaq';
import type { FaqItem } from './types';

export interface SelectTopFaqOptions extends FaqGateResolvers {
  /** Max items to show on open (default 5). */
  limit?: number;
  /** Optional "most-asked" popularity signal keyed by FAQ id — higher = more asked. */
  popularity?: Record<string, number>;
}

/**
 * Curate the top-N FAQ items to show on open from a (possibly 100+) authored list.
 *
 * Gated items are dropped first ({@link filterFaq}), then ranked by:
 *   pinned → most-asked popularity → manual priority → authored order.
 *
 * Pure and framework-agnostic — the search box / "browse all" affordance handles
 * the long tail; this just picks the few shown by default.
 */
export function selectTopFaq(items: FaqItem[], options: SelectTopFaqOptions = {}): FaqItem[] {
  const { limit = 5, popularity, ...resolvers } = options;
  const pop = (id: string) => popularity?.[id] ?? 0;

  return filterFaq(items, resolvers)
    .map((item, index) => ({ item, index }))
    .sort(
      (a, b) =>
        Number(b.item.pinned ?? false) - Number(a.item.pinned ?? false) ||
        pop(b.item.id) - pop(a.item.id) ||
        (b.item.priority ?? 0) - (a.item.priority ?? 0) ||
        a.index - b.index,
    )
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.item);
}
