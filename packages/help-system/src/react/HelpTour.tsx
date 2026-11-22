import { Component, type ErrorInfo, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import Joyride, { type CallBackProps, EVENTS, STATUS } from 'react-joyride';
import { resolveTargets } from '../core/resolveTargets';
import {
  type HelpTourContext,
  type HelpTourStep,
  planTour,
  type TourDirective,
  type TourPlanEvent,
} from '../core/tour';

/**
 * Guided page tour for the universal in-app help system (ADR-089).
 *
 * ENGINE: `react-joyride`. Its published `peerDependencies` cap React at 18, and
 * Bun logs a peer-range warning at install time — but the library imports and
 * renders cleanly under React 19 at runtime (verified with a render probe; it
 * never throws). We therefore use joyride directly rather than the overlay
 * fallback. To make that choice safe regardless, the whole tour is wrapped in a
 * `TourErrorBoundary` (below): if a future joyride/React-19 incompatibility ever
 * throws during render, the boundary swallows it and renders nothing, so a tour
 * crash degrades gracefully and can NEVER take down the host app.
 *
 * READ-ONLY: this component only guides. It never mutates app state — it reads
 * the DOM (via `data-help-id` selectors) and reports progress through callbacks.
 *
 * The step resolution (conditions, missing targets, fallbacks — §8a G7) lives in
 * the pure `planTour` (core/tour.ts); this component runs it against the live DOM
 * and emits the resulting events/directives.
 */
export type { HelpTourContext, HelpTourFallback, HelpTourStep, TourFallbackAction } from '../core/tour';

export interface HelpTourProps {
  steps: HelpTourStep[];
  /** Whether the tour is active. When `false`, nothing is rendered. */
  run: boolean;
  /** App state passed to each step's `when` predicate (G7). */
  context?: HelpTourContext;
  /** Fired when the user completes the final step. */
  onFinish?: () => void;
  /** Fired when the user dismisses the tour via the Skip control. */
  onSkip?: () => void;
  /** Fired with the new step index on each forward/back transition. */
  onStepChange?: (index: number) => void;
  /** Analytics for skipped/missing-target steps (G7). */
  onEvent?: (event: TourPlanEvent) => void;
  /** Run a fallback directive (navigate/show_faq/open_support) for a missing target (G7). */
  onFallback?: (directive: TourDirective) => void;
}

/** Whether a `data-help-id` target is present in the live DOM. */
const domTargetExists = (id: string): boolean =>
  typeof document !== 'undefined' && resolveTargets([id]).some(({ rect }) => rect.width > 0 && rect.height > 0);

/**
 * Class error boundary — joyride is the only class-requiring concern here. If
 * the tour subtree throws (e.g. a peer-version regression under React 19), we
 * catch it and render `null`: the help tour silently disappears instead of
 * crashing the page that embeds it. We deliberately do NOT rethrow.
 */
class TourErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Degrade quietly; surface for diagnostics without breaking the host app.
    console.warn('[help-system] HelpTour degraded — joyride render failed:', error, info.componentStack);
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children;
  }
}

/**
 * Theme-aware joyride styling (ADR-089 §G6). Two problems on a DARK page: (1) the
 * default overlay dims a dark background by so little that the un-dimmed target
 * barely stands out, and (2) joyride draws no ring, so the highlighted control has
 * no visible boundary. We deepen the overlay AND draw a bright ring + glow around
 * the spotlight, and map the tooltip to the app's shadcn theme tokens (`--popover`,
 * `--primary`, …) so light/dark both look native.
 */
const TOUR_STYLES = {
  options: {
    zIndex: 2147483000,
    // Map the tooltip chrome to the active theme — same tokens the panel uses.
    arrowColor: 'var(--popover, #ffffff)',
    backgroundColor: 'var(--popover, #ffffff)',
    textColor: 'var(--popover-foreground, #18181b)',
    primaryColor: 'var(--primary, #2563eb)',
    // Deepen the dim so the lit target separates hard from the surroundings on
    // dark pages (dimming a near-black background is otherwise barely perceptible).
    overlayColor: 'rgba(0, 0, 0, 0.8)',
    // The spotlight ring. joyride composes the spotlight's box-shadow as
    // `<dim 9999px>, <spotlightShadow>`, with the dim painted ON TOP — so an OUTSET
    // ring only bleeds through the dim at ~20% and washes out on dark surfaces. We
    // use an INSET ring instead: it paints inside the cut-out, over the target, so a
    // crisp white edge + cyan glow stays fully bright against ANY control colour.
    spotlightShadow:
      'inset 0 0 0 2px rgba(255, 255, 255, 0.95), inset 0 0 0 4px rgba(56, 189, 248, 0.9), inset 0 0 16px 3px rgba(56, 189, 248, 0.65)',
  },
  tooltipContainer: { textAlign: 'left' as const },
} as const;

export function HelpTour({ steps, run, context, onFinish, onSkip, onStepChange, onEvent, onFallback }: HelpTourProps) {
  // The longest target-wait window across steps; we re-plan once after it so a
  // late-mounting target resolves before we fall back (G7 `waitForTargetMs`).
  const maxWaitMs = useMemo(() => steps.reduce((m, s) => Math.max(m, s.waitForTargetMs ?? 0), 0), [steps]);
  // A value-less re-render trigger: bumping it re-runs the inline plan against
  // the (now updated) DOM after the wait window, without becoming a stale memo dep.
  const [, scheduleReplan] = useState(0);

  useEffect(() => {
    if (!run || maxWaitMs <= 0) return;
    const timer = setTimeout(() => scheduleReplan((n) => n + 1), maxWaitMs);
    return () => clearTimeout(timer);
  }, [run, maxWaitMs]);

  // Resolve conditions + missing targets + fallbacks against the live DOM. Computed
  // each render (cheap; only a few steps) so a re-render re-reads target presence.
  const plan = planTour(steps, { context, targetExists: domTargetExists });

  // Emit each resolved event/directive once (a signature ref stops re-renders re-firing).
  const emittedRef = useRef('');
  useEffect(() => {
    if (!run) return;
    const signature = JSON.stringify({ events: plan.events, directives: plan.directives });
    if (signature === emittedRef.current) return;
    emittedRef.current = signature;
    for (const event of plan.events) onEvent?.(event);
    for (const directive of plan.directives) onFallback?.(directive);
  }, [run, plan, onEvent, onFallback]);

  // Inactive, or nothing eligible to render (every step gated/missing) → render
  // nothing. Directives (e.g. navigate) still fired above.
  if (!run || plan.steps.length === 0) {
    return null;
  }

  const handleCallback = (data: CallBackProps) => {
    const { status, type, index } = data;

    if (status === STATUS.FINISHED) {
      onFinish?.();
      return;
    }
    if (status === STATUS.SKIPPED) {
      onSkip?.();
      return;
    }
    // A completed step transition (not the terminal finish/skip, which carry a
    // TOUR_END type) advances the index — report it for syncing external UI.
    if (type === EVENTS.STEP_AFTER) {
      onStepChange?.(index);
    }
  };

  return (
    <TourErrorBoundary>
      <Joyride
        steps={plan.steps}
        run={run}
        continuous
        showSkipButton
        // A gap between the control and the inset ring so the halo sits in the
        // padding rather than over the control's own label.
        spotlightPadding={8}
        // Keep scrolled targets below sticky navigation and save controls.
        scrollOffset={96}
        callback={handleCallback}
        // Accessible labels on every control (the help system is universal and
        // must be operable without relying on joyride's default English copy).
        locale={{ back: 'Back', close: 'Close', last: 'Done', next: 'Next', skip: 'Skip tour' }}
        styles={TOUR_STYLES}
      />
    </TourErrorBoundary>
  );
}
