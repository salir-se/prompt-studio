// @module-tag dom
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// We mock react-joyride to assert HelpTour's callback wiring deterministically,
// without standing up joyride's full floater/popper DOM (which is timing- and
// layout-dependent and not what we're testing here). The mock renders the
// CURRENT eligible step's body + title and exposes Finish/Skip/Next buttons that
// invoke `callback` with the real STATUS/ACTIONS shape react-joyride emits.
//
// `vi.mock` is hoisted, so the factory must not close over outer variables; we
// re-import the mocked module inside tests when we need to read what was passed.
vi.mock('react-joyride', () => {
  const STATUS = {
    IDLE: 'idle',
    READY: 'ready',
    WAITING: 'waiting',
    RUNNING: 'running',
    PAUSED: 'paused',
    SKIPPED: 'skipped',
    FINISHED: 'finished',
    ERROR: 'error',
  } as const;
  const ACTIONS = {
    INIT: 'init',
    START: 'start',
    STOP: 'stop',
    RESET: 'reset',
    PREV: 'prev',
    NEXT: 'next',
    GO: 'go',
    CLOSE: 'close',
    SKIP: 'skip',
    UPDATE: 'update',
  } as const;
  const EVENTS = {
    TOUR_START: 'tour:start',
    STEP_BEFORE: 'step:before',
    STEP_AFTER: 'step:after',
    TOUR_END: 'tour:end',
  } as const;

  // Minimal fake that mirrors the props HelpTour passes and drives `callback`.
  function FakeJoyride(props: {
    run?: boolean;
    steps: Array<{ target: string; title?: React.ReactNode; content: React.ReactNode }>;
    callback?: (data: { action: string; index: number; status: string; type: string }) => void;
  }) {
    if (!props.run || props.steps.length === 0) return null;
    const step = props.steps[0];
    const fire = (status: string, action: string, index: number, type: string) =>
      props.callback?.({ status, action, index, type });
    return (
      <div data-testid="fake-joyride">
        {step.title ? <div data-testid="step-title">{step.title}</div> : null}
        {/* Expose the resolved selector so a test can assert targetHelpId → selector mapping. */}
        <div data-testid="step-target">{step.target}</div>
        <div data-testid="step-body">{step.content}</div>
        <button type="button" onClick={() => fire(STATUS.RUNNING, ACTIONS.NEXT, 1, EVENTS.STEP_AFTER)}>
          mock-next
        </button>
        <button
          type="button"
          onClick={() => fire(STATUS.FINISHED, ACTIONS.NEXT, props.steps.length - 1, EVENTS.TOUR_END)}
        >
          mock-finish
        </button>
        <button type="button" onClick={() => fire(STATUS.SKIPPED, ACTIONS.SKIP, 0, EVENTS.TOUR_END)}>
          mock-skip
        </button>
      </div>
    );
  }

  return { default: FakeJoyride, STATUS, ACTIONS, EVENTS };
});

// Imported after vi.mock so the mock is in effect.
import { HelpTour, type HelpTourStep } from './HelpTour';

// NB: no manual `document.body.innerHTML = ''` afterEach — HelpTour renders no
// portal itself, and the mocked Joyride mounts inline; Testing-Library's
// auto-cleanup unmounts everything between tests.
beforeEach(() => {
  document.body.innerHTML = '<button data-help-id="scout.run">Run</button>';
  vi.spyOn(document.querySelector('[data-help-id="scout.run"]')!, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(10, 10, 120, 40),
  );
});

describe('HelpTour (react-joyride engine)', () => {
  it('shows the first eligible step body when run is true', () => {
    const steps: HelpTourStep[] = [
      { targetHelpId: 'scout.run', title: 'Run Scout', body: 'Click here to start a search.' },
    ];
    render(<HelpTour steps={steps} run />);
    expect(screen.getByTestId('step-body')).toHaveTextContent('Click here to start a search.');
    expect(screen.getByTestId('step-title')).toHaveTextContent('Run Scout');
  });

  it('skips empty wrappers and hidden controls instead of spotlighting blank space', () => {
    const empty = document.createElement('div');
    empty.dataset.helpId = 'empty';
    document.body.append(empty);
    const hidden = document.createElement('button');
    hidden.dataset.helpId = 'hidden';
    hidden.hidden = true;
    document.body.append(hidden);
    render(
      <HelpTour
        steps={[
          { targetHelpId: 'empty', body: 'blank space' },
          { targetHelpId: 'hidden', body: 'hidden control' },
          { targetHelpId: 'scout.run', body: 'visible control' },
        ]}
        run
      />,
    );
    expect(screen.getByTestId('step-body')).toHaveTextContent('visible control');
  });

  it('renders nothing visible when run is false', () => {
    const steps: HelpTourStep[] = [{ targetHelpId: 'scout.run', body: 'hidden until run' }];
    render(<HelpTour steps={steps} run={false} />);
    expect(screen.queryByTestId('fake-joyride')).not.toBeInTheDocument();
  });

  it('skips a step whose `when` returns false, surfacing the next eligible step first', () => {
    const steps: HelpTourStep[] = [
      { targetHelpId: 'scout.run', body: 'should be skipped', when: () => false },
      { targetHelpId: 'scout.run', body: 'first visible step' },
    ];
    render(<HelpTour steps={steps} run />);
    // The mock renders steps[0] of the *filtered* list, so the gated step must be gone.
    expect(screen.getByTestId('step-body')).toHaveTextContent('first visible step');
    expect(screen.queryByText('should be skipped')).not.toBeInTheDocument();
  });

  it('keeps a step whose `when` returns true', () => {
    const steps: HelpTourStep[] = [{ targetHelpId: 'scout.run', body: 'gated in', when: () => true }];
    render(<HelpTour steps={steps} run />);
    expect(screen.getByTestId('step-body')).toHaveTextContent('gated in');
  });

  it('maps targetHelpId to the [data-help-id="..."] selector for joyride', () => {
    const steps: HelpTourStep[] = [{ targetHelpId: 'scout.run', body: 'x' }];
    render(<HelpTour steps={steps} run />);
    // The mock echoes the `step.target` HelpTour built; it must be the data-help-id selector.
    expect(screen.getByTestId('step-target')).toHaveTextContent('[data-help-id="scout.run"]');
  });

  it('invokes onFinish when the tour finishes', async () => {
    const onFinish = vi.fn();
    const steps: HelpTourStep[] = [{ targetHelpId: 'scout.run', body: 'done' }];
    render(<HelpTour steps={steps} run onFinish={onFinish} />);
    await userEvent.click(screen.getByRole('button', { name: 'mock-finish' }));
    expect(onFinish).toHaveBeenCalledTimes(1);
  });

  it('invokes onSkip when the tour is skipped', async () => {
    const onSkip = vi.fn();
    const steps: HelpTourStep[] = [{ targetHelpId: 'scout.run', body: 'skip me' }];
    render(<HelpTour steps={steps} run onSkip={onSkip} />);
    await userEvent.click(screen.getByRole('button', { name: 'mock-skip' }));
    expect(onSkip).toHaveBeenCalledTimes(1);
  });

  it('invokes onStepChange on a step transition', async () => {
    const onStepChange = vi.fn();
    const steps: HelpTourStep[] = [
      { targetHelpId: 'scout.run', body: 'a' },
      { targetHelpId: 'scout.run', body: 'b' },
    ];
    render(<HelpTour steps={steps} run onStepChange={onStepChange} />);
    await userEvent.click(screen.getByRole('button', { name: 'mock-next' }));
    expect(onStepChange).toHaveBeenCalledWith(1);
  });

  it('renders nothing (no crash) when every step is filtered out', () => {
    const steps: HelpTourStep[] = [{ targetHelpId: 'scout.run', body: 'never', when: () => false }];
    render(<HelpTour steps={steps} run />);
    expect(screen.queryByTestId('fake-joyride')).not.toBeInTheDocument();
  });

  it('passes context to `when` and emits step_skipped_by_condition (G7)', () => {
    const onEvent = vi.fn();
    const steps: HelpTourStep[] = [
      { targetHelpId: 'scout.run', body: 'gated', when: (ctx) => ctx.ready === true },
      { targetHelpId: 'scout.run', body: 'shown' },
    ];
    render(<HelpTour steps={steps} run context={{ ready: false }} onEvent={onEvent} />);
    expect(screen.getByTestId('step-body')).toHaveTextContent('shown');
    expect(onEvent).toHaveBeenCalledWith({ kind: 'step_skipped_by_condition', targetHelpId: 'scout.run' });
  });

  it('renders a centered fallback tooltip + emits target_missing when the target is absent (G7)', () => {
    const onEvent = vi.fn();
    const steps: HelpTourStep[] = [{ targetHelpId: 'not.in.dom', body: 'real', fallback: { body: 'not here yet' } }];
    render(<HelpTour steps={steps} run onEvent={onEvent} />);
    expect(screen.getByTestId('step-body')).toHaveTextContent('not here yet');
    expect(screen.getByTestId('step-target')).toHaveTextContent('body');
    expect(onEvent).toHaveBeenCalledWith({
      kind: 'target_missing',
      targetHelpId: 'not.in.dom',
      fallbackAction: undefined,
    });
  });

  it('runs a fallback directive for a missing target whose fallback is an action (G7)', () => {
    const onFallback = vi.fn();
    const steps: HelpTourStep[] = [
      { targetHelpId: 'not.in.dom', body: 'real', fallback: { action: 'navigate', pageKey: 'Settings' } },
    ];
    render(<HelpTour steps={steps} run onFallback={onFallback} />);
    // No renderable step → joyride absent, but the directive fired.
    expect(screen.queryByTestId('fake-joyride')).not.toBeInTheDocument();
    expect(onFallback).toHaveBeenCalledWith({ action: 'navigate', pageKey: 'Settings', targetHelpId: 'not.in.dom' });
  });
});

// Compatibility gate (ADR-089): react-joyride peers React 16–18 but this repo is
// React 19. These tests exercise the REAL library (not the mock above) to prove it
// imports and renders without throwing under React 19 — the prerequisite for using
// joyride as HelpTour's engine instead of the overlay fallback. We unmock + reset
// the module registry and dynamically re-import HelpTour so it binds the real
// joyride for just this block; the mocked describe above is unaffected.
// Real joyride's RUNNING transition schedules detached timers (see the drain
// note below); the longest chain is its ~300 ms scroll animation plus a 10 ms
// popper reposition. 600 ms covers that with slack — the price of proving the
// real library against the real clock, paid once per suite run.
const JOYRIDE_TIMER_DRAIN_MS = 600;

describe('HelpTour (real react-joyride · React 19 compatibility gate)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<button data-help-id="scout.run">Run</button>';
    vi.spyOn(document.querySelector('[data-help-id="scout.run"]')!, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(10, 10, 120, 40),
    );
    vi.doUnmock('react-joyride');
    vi.resetModules();
  });

  it('imports the real STATUS constants from react-joyride', async () => {
    const joyride = await vi.importActual<typeof import('react-joyride')>('react-joyride');
    expect(joyride.default).toBeTypeOf('function');
    expect(joyride.STATUS.FINISHED).toBe('finished');
  });

  it('renders the real Joyride tour without throwing (and mounts joyride DOM, not the mock)', async () => {
    const { HelpTour: RealHelpTour } = await import('./HelpTour');
    const steps: HelpTourStep[] = [{ targetHelpId: 'scout.run', body: 'real joyride step' }];
    // The render itself must not throw under React 19.
    let view!: ReturnType<typeof render>;
    expect(() => {
      view = render(<RealHelpTour steps={steps} run />);
    }).not.toThrow();
    // We're exercising the REAL library, not the deterministic mock above.
    expect(screen.queryByTestId('fake-joyride')).not.toBeInTheDocument();
    // joyride mounts its overlay portal asynchronously (READY → RUNNING lifecycle);
    // waitFor lets that settle without a brittle fixed delay. Its presence proves
    // the real library both loaded and rendered DOM under React 19.
    await waitFor(() => expect(document.querySelector('.react-joyride__overlay')).toBeInTheDocument());
    // Reaching RUNNING leaves real-joyride timers behind that SURVIVE unmount:
    // the beacon focus (0 ms), an overlay reposition (100 ms), and a
    // scrollTo(...).then(setTimeout(→ popper.update, 10)) chain whose ~300 ms
    // scroll animation outlives this test body. Unmount, then hold this file's
    // happy-dom env open until they have all fired — otherwise they detonate
    // after env teardown as the nondeterministic "window is not defined"
    // uncaught exception that forced dangerouslyIgnoreUnhandledErrors in
    // vitest.monorepo.ts (or, worse, popper silently updates against a LATER
    // test file's window).
    view.unmount();
    await new Promise((resolve) => setTimeout(resolve, JOYRIDE_TIMER_DRAIN_MS));
  });
});
