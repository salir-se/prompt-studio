import type { HelpTourStep } from './tour';
import type { HelpContent } from './types';

// Target-health scanner (ADR-089 §8a G11). Pure + framework-agnostic.
//
// Validates that the content registry's `data-help-id` references actually
// resolve in the DOM, exactly once, and that FAQ video references exist. Powers a
// dev-only "Help Debug Mode" overlay and an optional CI check. Pass DOM presence
// as counts so the core stays free of the DOM; `collectDomHelpIdCounts` is the
// browser reader.

export type TargetIssueKind = 'missing_target' | 'duplicate_target' | 'missing_video';

export interface TargetIssue {
  kind: TargetIssueKind;
  /** The offending `data-help-id` (for target issues). */
  helpId?: string;
  /** The offending video id (for `missing_video`). */
  videoId?: string;
  /** Page the issue was found on. */
  pageKey?: string;
  /** Tour the issue was found in (when the reference came from a tour step). */
  tourId?: string;
  /** Human-readable explanation. */
  detail: string;
}

export interface ScanHelpTargetsInput {
  content: HelpContent;
  /** Authored tours keyed by id (defaults to none). */
  tours?: Record<string, HelpTourStep[]>;
  /** DOM `data-help-id` → element count (a Map or a lookup fn). */
  domHelpIdCounts: Map<string, number> | ((helpId: string) => number);
  /**
   * Scope to a single page (the current page for the dev overlay) to avoid false
   * "missing" reports for off-screen pages. Omit to scan everything (CI, with
   * every page mounted).
   */
  pageKey?: string;
}

/**
 * Report content references whose targets are missing or duplicated in the DOM,
 * and FAQ items pointing at videos absent from the registry. Pure: presence is
 * supplied via `domHelpIdCounts`.
 */
export function scanHelpTargets(input: ScanHelpTargetsInput): TargetIssue[] {
  const { content, tours = {}, domHelpIdCounts, pageKey } = input;
  const count = typeof domHelpIdCounts === 'function' ? domHelpIdCounts : (id: string) => domHelpIdCounts.get(id) ?? 0;
  const videoIds = new Set(Object.keys(content.videos ?? {}));
  const issues: TargetIssue[] = [];

  const checkTarget = (helpId: string, where: { pageKey?: string; tourId?: string }, source: string): void => {
    const c = count(helpId);
    if (c === 0) {
      issues.push({
        kind: 'missing_target',
        helpId,
        ...where,
        detail: `${source} targets "${helpId}" which is not in the DOM`,
      });
    } else if (c > 1) {
      issues.push({
        kind: 'duplicate_target',
        helpId,
        ...where,
        detail: `data-help-id "${helpId}" appears ${c}× (must be unique on the page)`,
      });
    }
  };

  const pageEntries = pageKey
    ? content.pages[pageKey]
      ? ([[pageKey, content.pages[pageKey]]] as const)
      : []
    : Object.entries(content.pages);

  for (const [key, page] of pageEntries) {
    for (const highlightable of page.highlightables ?? []) {
      checkTarget(highlightable.helpId, { pageKey: key }, `highlightable on "${key}"`);
    }
    for (const item of page.faq) {
      if (item.videoId && !videoIds.has(item.videoId)) {
        issues.push({
          kind: 'missing_video',
          videoId: item.videoId,
          pageKey: key,
          detail: `FAQ "${item.id}" references unknown video "${item.videoId}"`,
        });
      }
    }
  }

  const tourEntries = pageKey ? (tours[pageKey] ? ([[pageKey, tours[pageKey]]] as const) : []) : Object.entries(tours);
  for (const [tourId, steps] of tourEntries) {
    for (const step of steps) {
      checkTarget(step.targetHelpId, { tourId }, `tour "${tourId}" step`);
    }
  }

  return issues;
}

/** Read `data-help-id` → element count from a DOM root (browser only; empty in SSR/tests w/o DOM). */
export function collectDomHelpIdCounts(
  root: ParentNode | undefined = typeof document === 'undefined' ? undefined : document,
): Map<string, number> {
  const counts = new Map<string, number>();
  if (!root) return counts;
  for (const el of root.querySelectorAll('[data-help-id]')) {
    const id = el.getAttribute('data-help-id');
    if (!id) continue;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }
  return counts;
}
