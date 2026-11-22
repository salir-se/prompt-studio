// @module-tag dom
import { describe, expect, it } from 'vitest';
import { type HelpTourStep, planTour } from './tour';

const present = new Set(['a', 'b']);
const targetExists = (id: string) => present.has(id);

describe('planTour', () => {
  it('renders present-target steps mapped to the data-help-id selector', () => {
    const steps: HelpTourStep[] = [{ targetHelpId: 'a', title: 'A', body: 'do a' }];
    const plan = planTour(steps, { targetExists });
    expect(plan.steps).toEqual([{ target: '[data-help-id="a"]', title: 'A', content: 'do a', disableBeacon: true }]);
    expect(plan.events).toEqual([]);
  });

  it('drops a step whose `when(ctx)` is false and emits step_skipped_by_condition', () => {
    const steps: HelpTourStep[] = [
      { targetHelpId: 'a', body: 'gated out', when: (ctx) => ctx.ready === true },
      { targetHelpId: 'b', body: 'kept' },
    ];
    const plan = planTour(steps, { targetExists, context: { ready: false } });
    expect(plan.steps.map((s) => s.content)).toEqual(['kept']);
    expect(plan.events).toEqual([{ kind: 'step_skipped_by_condition', targetHelpId: 'a' }]);
  });

  it('passes context to `when`', () => {
    const steps: HelpTourStep[] = [{ targetHelpId: 'a', body: 'shown', when: (ctx) => ctx.ready === true }];
    expect(planTour(steps, { targetExists, context: { ready: true } }).steps).toHaveLength(1);
  });

  it('renders a centered fallback tooltip when the target is missing but fallback.body is set', () => {
    const steps: HelpTourStep[] = [{ targetHelpId: 'gone', body: 'real', fallback: { body: 'not here yet' } }];
    const plan = planTour(steps, { targetExists });
    expect(plan.steps).toEqual([
      { target: 'body', placement: 'center', title: undefined, content: 'not here yet', disableBeacon: true },
    ]);
    expect(plan.events).toEqual([{ kind: 'target_missing', targetHelpId: 'gone', fallbackAction: undefined }]);
  });

  it('emits a directive for a missing target with a non-skip fallback action', () => {
    const steps: HelpTourStep[] = [
      { targetHelpId: 'gone', body: 'x', fallback: { action: 'navigate', pageKey: 'Settings' } },
    ];
    const plan = planTour(steps, { targetExists });
    expect(plan.steps).toHaveLength(0);
    expect(plan.directives).toEqual([{ action: 'navigate', pageKey: 'Settings', targetHelpId: 'gone' }]);
    expect(plan.events).toEqual([{ kind: 'target_missing', targetHelpId: 'gone', fallbackAction: 'navigate' }]);
  });

  it('silently skips a missing target with no fallback (back-compat)', () => {
    const plan = planTour([{ targetHelpId: 'gone', body: 'x' }], { targetExists });
    expect(plan.steps).toHaveLength(0);
    expect(plan.directives).toHaveLength(0);
    expect(plan.events).toEqual([{ kind: 'target_missing', targetHelpId: 'gone', fallbackAction: undefined }]);
  });
});
