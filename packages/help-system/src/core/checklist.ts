// Cross-page onboarding checklist (ADR-089 §8a G8). Pure + framework-agnostic.
//
// READ-ONLY: a checklist only observes the existing milestone stream — it never
// forces or performs an action. Each item completes when its `completionMilestone`
// has fired; `checklistProgress` projects a definition against the set of fired
// milestones for rendering. Resumable: the host persists the fired milestones (or
// derives them from its milestone log) and passes them in.

export interface ChecklistItem {
  id: string;
  label: string;
  /** Page the item relates to (host can deep-link / start a tour there). */
  pageKey?: string;
  /** Optional tour to launch for this item. */
  tourId?: string;
  /** The milestone whose firing marks this item complete. */
  completionMilestone: string;
}

export interface ChecklistDefinition {
  id: string;
  title: string;
  items: ChecklistItem[];
}

/** Checklists keyed by id. */
export type ChecklistRegistry = Record<string, ChecklistDefinition>;

export interface ChecklistItemProgress {
  item: ChecklistItem;
  done: boolean;
}

export interface ChecklistProgress {
  id: string;
  title: string;
  items: ChecklistItemProgress[];
  doneCount: number;
  total: number;
  /** True when every item is done. */
  complete: boolean;
  /** The first not-yet-done item (the suggested next action), if any. */
  nextItem?: ChecklistItem;
}

/**
 * Project a checklist definition against the set of fired milestones. Pure:
 * an item is done iff its `completionMilestone` is in `firedMilestones`.
 */
export function checklistProgress(
  definition: ChecklistDefinition,
  firedMilestones: ReadonlySet<string>,
): ChecklistProgress {
  const items = definition.items.map((item) => ({ item, done: firedMilestones.has(item.completionMilestone) }));
  const doneCount = items.reduce((n, i) => n + (i.done ? 1 : 0), 0);
  return {
    id: definition.id,
    title: definition.title,
    items,
    doneCount,
    total: items.length,
    complete: items.length > 0 && doneCount === items.length,
    nextItem: items.find((i) => !i.done)?.item,
  };
}
