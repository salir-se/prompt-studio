// @module-tag dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePanelState } from '../hooks/use-panel-state';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import { ShortcutContext } from '../shortcuts/shortcut-context';
import { RunWorkspace } from './RunWorkspace';
import type { EvalSuite } from './contracts';
import { CAPTURED_EVALUATION, CAPTURED_RUN, RUN_SETTINGS, RUN_SETUP, RUN_SOURCE, TAG_CANDIDATE } from './run-fixtures';

vi.mock('../prompt-repo/prompt-repo-client', () => ({ studioJson: vi.fn() }));
const request = vi.mocked(studioJson);
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

async function start(dock = true, onOpenEvaluations?: () => void, retained = false) {
  let savedSuite: EvalSuite | undefined;
  request.mockImplementation(async (path, init) => {
    if (init?.method === 'POST') {
      if (path.endsWith('/suites')) {
        savedSuite = JSON.parse(init.body ?? '{}').suite;
        return { suite: savedSuite };
      }
      if (path.endsWith('/evaluations')) {
        const body = JSON.parse(init.body ?? '{}');
        return {
          evaluation: {
            ...CAPTURED_EVALUATION,
            id: body.id,
            suite: savedSuite,
            candidates: body.candidates,
            judge: undefined,
            results: [{ ...CAPTURED_EVALUATION.results[1], caseId: savedSuite?.cases[0]?.id }],
          },
        };
      }
      return { ok: true };
    }
    if (path.endsWith('/settings')) return RUN_SETTINGS;
    if (path.includes('/profile?')) return { profile: RUN_SETUP };
    if (path.includes('/suites?')) return { suites: [] };
    if (path.includes('/versions?')) return { versions: [TAG_CANDIDATE] };
    if (path.includes('/evaluations?')) return { evaluations: [] };
    return { runs: [] };
  });
  const props = {
    dock,
    onOpenEvaluations,
    project: { projectId: 'project-example', revision: 3 },
    promptPath: CAPTURED_RUN.promptPath,
    source: RUN_SOURCE,
    draft: false,
    onClose: vi.fn(),
  };
  function RetainedDock() {
    const panels = usePanelState();
    return (
      <ShortcutContext.Provider
        value={{
          compactToolbars: true,
          lineNumbers: false,
          setLineNumbers: () => {},
          open: () => {},
          teach: () => {},
        }}
      >
        <button type="button" onClick={() => panels.toggleEvaluations()}>
          Toggle evaluations
        </button>
        {panels.retainedEvaluation && (
          <RunWorkspace {...props} hidden={panels.activePanel !== 'evaluate'} onDirtyChange={panels.onDirtyChange} />
        )}
      </ShortcutContext.Provider>
    );
  }
  render(retained ? <RetainedDock /> : <RunWorkspace {...props} />);
  if (retained) fireEvent.click(screen.getByRole('button', { name: 'Toggle evaluations' }));
  await act(async () => {});
}

it('creates and runs saved tests in the evaluations dock using Ctrl+Enter', async () => {
  await start();
  expect(screen.getByRole('heading', { name: 'Evaluations' })).toBeVisible();
  expect(screen.queryByRole('tab', { name: 'Single run' })).not.toBeInTheDocument();
  const panel = within(screen.getByRole('tabpanel', { name: 'Test suites' }));
  fireEvent.click(panel.getByRole('button', { name: 'New suite' }));
  fireEvent.change(panel.getByRole('textbox', { name: 'Suite name' }), { target: { value: 'Regression suite' } });
  fireEvent.change(panel.getByRole('textbox', { name: 'subject' }), { target: { value: 'Battery recycling' } });
  fireEvent.click(panel.getByRole('button', { name: 'Save suite' }));
  await act(async () => {});
  fireEvent.keyDown(panel.getByRole('textbox', { name: 'subject' }), { key: 'Enter', ctrlKey: true });
  await act(async () => {});
  const save = request.mock.calls.find(([path, init]) => path.endsWith('/suites') && init?.method === 'POST');
  const run = request.mock.calls.find(([path, init]) => path.endsWith('/evaluations') && init?.method === 'POST');
  expect(JSON.parse(save?.[1]?.body ?? '{}').suite.name).toBe('Regression suite');
  expect(JSON.parse(save?.[1]?.body ?? '{}').suite.cases[0].inputs.subject).toBe('Battery recycling');
  expect(JSON.parse(run?.[1]?.body ?? '{}').suiteId).toBe(JSON.parse(save?.[1]?.body ?? '{}').suite.id);
  expect(panel.getByText(/Choose certified recycling facilities/)).toBeInTheDocument();
});

it('preserves fields and the active tab while minimizing, expanding and restoring', async () => {
  await start();
  const tab = screen.getByRole('tab', { name: 'Compare' });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
  const compare = within(screen.getByRole('tabpanel', { name: 'Compare' }));
  fireEvent.click(compare.getByRole('checkbox', { name: 'Judge both answers' }));
  fireEvent.change(compare.getByRole('textbox', { name: 'Judging rubric' }), {
    target: { value: 'Keep this criterion' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Expand evaluations' }));
  fireEvent.click(screen.getByRole('button', { name: 'Minimize evaluations' }));
  fireEvent.click(screen.getByRole('button', { name: 'Restore evaluations' }));
  expect(compare.getByRole('textbox', { name: 'Judging rubric' })).toHaveValue('Keep this criterion');
  expect(screen.getByRole('tab', { name: 'Compare' })).toHaveAttribute('aria-selected', 'true');
  fireEvent.click(screen.getByRole('button', { name: 'Restore evaluation height' }));
  expect(compare.getByRole('textbox', { name: 'Judging rubric' })).toHaveValue('Keep this criterion');
});

it('keeps single runs in the side workspace and opens the separate evaluations panel explicitly', async () => {
  const onOpenEvaluations = vi.fn();
  await start(false, onOpenEvaluations);
  expect(screen.getByRole('tab', { name: 'Single run' })).toBeVisible();
  expect(screen.queryByRole('tab', { name: 'Test suites' })).not.toBeInTheDocument();
  expect(screen.queryByRole('tab', { name: 'Compare' })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Open evaluations' }));
  expect(onOpenEvaluations).toHaveBeenCalledOnce();
});

it('#2490: hides and restores a dock without losing its draft suite or selected tab', async () => {
  await start(true, undefined, true);
  const panel = within(screen.getByRole('tabpanel', { name: 'Test suites' }));
  fireEvent.click(panel.getByRole('button', { name: 'New suite' }));
  fireEvent.change(panel.getByRole('textbox', { name: 'Suite name' }), { target: { value: 'Keep unfinished suite' } });
  const field = panel.getByRole('textbox', { name: 'Suite name' });
  const expand = screen.getByRole('button', { name: 'Expand evaluations' });
  expect(expand).toHaveAttribute('data-toolbar-mode', 'icons');
  expect(expand.querySelector('svg')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Minimize evaluations' })).toHaveAttribute('data-toolbar-mode', 'icons');
  expect(screen.getByRole('button', { name: 'Close evaluations' })).toHaveAttribute('data-toolbar-mode', 'icons');
  fireEvent.click(screen.getByRole('button', { name: 'Toggle evaluations' }));
  expect(screen.queryByRole('heading', { name: 'Evaluations' })).not.toBeInTheDocument();
  expect(field).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Toggle evaluations' }));
  expect(screen.getByRole('tab', { name: 'Test suites' })).toHaveAttribute('aria-selected', 'true');
  expect(screen.getByRole('textbox', { name: 'Suite name' })).toBe(field);
  expect(field).toHaveValue('Keep unfinished suite');
});
