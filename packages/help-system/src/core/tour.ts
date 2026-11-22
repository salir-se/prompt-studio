// Guided-tour model + planner (ADR-089 §8a G7). Pure + framework-agnostic so
// the resolution logic (conditions, missing targets, fallbacks) is unit-testable
// without react-joyride or a DOM. The React component (`react/HelpTour`) renders
// the plan and emits the events.

/** App state passed to a step's `when` predicate (host-shaped; opaque here). */
export type HelpTourContext = Record<string, unknown>;

/** What to do when a step's target is missing (after waiting) and can't render. */
export type TourFallbackAction = 'skip' | 'navigate' | 'show_faq' | 'open_support';

/** Fallback behavior for a step whose target never appears. */
export interface HelpTourFallback {
  /** Show a centered, targetless tooltip with this copy instead of skipping. */
  body?: string;
  /** Otherwise take this action. `skip` (default) simply drops the step. */
  action?: TourFallbackAction;
  /** Destination page key when `action` is `navigate`. */
  pageKey?: string;
}

/** A single tour step authored by the host. */
export interface HelpTourStep {
  /** `data-help-id` of the element to spotlight. Mapped to `[data-help-id="…"]`. */
  targetHelpId: string;
  /** Optional heading shown above the body. */
  title?: string;
  /** Step copy (required). */
  body: string;
  /**
   * Optional predicate evaluated against app state. When it returns `false` the
   * step is omitted (e.g. a step that only applies once a panel is open). A
   * missing `when` always keeps the step.
   */
  when?: (ctx: HelpTourContext) => boolean;
  /** Poll up to this long (ms) for a missing target before applying the fallback. */
  waitForTargetMs?: number;
  /** What to do when the target is missing after waiting. Default: skip the step. */
  fallback?: HelpTourFallback;
}

/** Analytics emitted while resolving a tour (G7). */
export type TourPlanEventKind = 'step_skipped_by_condition' | 'target_missing';
export interface TourPlanEvent {
  kind: TourPlanEventKind;
  targetHelpId: string;
  /** For `target_missing`, the fallback action taken (if any). */
  fallbackAction?: TourFallbackAction;
}

/** A joyride-ready step (the shape `react-joyride` consumes). */
export interface PlannedJoyrideStep {
  target: string;
  title?: string;
  content: string;
  disableBeacon: true;
  /** `center` for a targetless fallback tooltip. */
  placement?: 'center';
}

/** A side-effect directive for a missing target whose fallback is an action. */
export interface TourDirective {
  action: Exclude<TourFallbackAction, 'skip'>;
  pageKey?: string;
  targetHelpId: string;
}

export interface TourPlan {
  steps: PlannedJoyrideStep[];
  events: TourPlanEvent[];
  directives: TourDirective[];
}

/** Map a `data-help-id` to the attribute selector joyride targets. */
export const helpIdSelector = (id: string): string => `[data-help-id="${id}"]`;

/**
 * Resolve authored steps into a joyride-ready plan given the current app context
 * and which targets exist in the DOM. Pure: callers supply `targetExists`.
 *
 * Per step:
 * - `when(ctx) === false` → dropped, emits `step_skipped_by_condition`.
 * - target present → rendered normally.
 * - target missing → emits `target_missing`; then `fallback.body` renders a
 *   centered tooltip, a non-`skip` `fallback.action` produces a directive, and
 *   anything else drops the step.
 */
export function planTour(
  steps: HelpTourStep[],
  opts: { context?: HelpTourContext; targetExists: (helpId: string) => boolean },
): TourPlan {
  const { context = {}, targetExists } = opts;
  const plan: TourPlan = { steps: [], events: [], directives: [] };

  for (const step of steps) {
    if (step.when && !step.when(context)) {
      plan.events.push({ kind: 'step_skipped_by_condition', targetHelpId: step.targetHelpId });
      continue;
    }
    if (targetExists(step.targetHelpId)) {
      plan.steps.push({
        target: helpIdSelector(step.targetHelpId),
        title: step.title,
        content: step.body,
        disableBeacon: true,
      });
      continue;
    }
    // Target missing.
    const action = step.fallback?.action;
    plan.events.push({ kind: 'target_missing', targetHelpId: step.targetHelpId, fallbackAction: action });
    if (step.fallback?.body) {
      plan.steps.push({
        target: 'body',
        placement: 'center',
        title: step.title,
        content: step.fallback.body,
        disableBeacon: true,
      });
    } else if (action && action !== 'skip') {
      plan.directives.push({ action, pageKey: step.fallback?.pageKey, targetHelpId: step.targetHelpId });
    }
    // else: skip (drop the step).
  }

  return plan;
}
