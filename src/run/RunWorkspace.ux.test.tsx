// @module-tag dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import { RunWorkspace } from './RunWorkspace';
import {
  CAPTURED_EVALUATION,
  CAPTURED_RUN,
  RUN_SETTINGS,
  RUN_SETUP,
  RUN_SOURCE,
  TAG_CANDIDATE,
  TEST_SUITE,
} from './run-fixtures';
import { announceRunSettings } from './run-settings-events';

vi.mock('../prompt-repo/prompt-repo-client', () => ({ studioJson: vi.fn() }));
const request = vi.mocked(studioJson);
const openAppSettings = vi.fn();
vi.mock('../shortcuts/shortcut-context', () => ({
  useShortcutEducation: () => ({ compactToolbars: true, open: openAppSettings, teach: vi.fn() }),
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
async function start(history: unknown[] = [], connected = true) {
  request.mockImplementation(async (path, init) => {
    if (init?.method === 'POST') {
      if (path.endsWith('/evaluations')) return { evaluation: CAPTURED_EVALUATION };
      if (path === '/__studio/run') return { run: CAPTURED_RUN };
      return { ok: true };
    }
    if (path.endsWith('/settings')) return { ...RUN_SETTINGS, connected };
    if (path.includes('/profile?')) return { profile: RUN_SETUP };
    if (path.includes('/suites?')) return { suites: [TEST_SUITE] };
    if (path.includes('/versions?')) return { versions: [TAG_CANDIDATE] };
    if (path.includes('/evaluations?')) return { evaluations: history };
    if (path.includes('/evaluations/')) throw new Error('Evaluation not found');
    return { runs: [] };
  });
  render(
    <RunWorkspace
      project={{ projectId: 'project-example', revision: 3 }}
      promptPath={CAPTURED_RUN.promptPath}
      source={RUN_SOURCE}
      draft={false}
      onClose={vi.fn()}
    />,
  );
  await screen.findByRole('button', { name: /^Run prompt/ });
  const tab = screen.getByRole('tab', { name: 'Compare' });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
  await act(async () => {});
  const compare = within(screen.getByRole('tabpanel', { name: 'Compare' }));
  fireEvent.click(compare.getByRole('button', { name: 'Edit skill attachments' }));
  return compare;
}
it('inherits application model changes and selects attachments in Compare and runs the chosen setup using the same shortcut', async () => {
  const compare = await start();
  act(() => announceRunSettings({ ...RUN_SETTINGS, model: 'candidate-model' }));
  fireEvent.click(compare.getByRole('checkbox', { name: /Clear writing/ }));
  fireEvent.keyDown(compare.getByRole('searchbox'), { key: 'Enter', ctrlKey: true });
  await act(async () => {});
  const sent = request.mock.calls.find(([path, init]) => path.endsWith('/evaluations') && init?.method === 'POST');
  expect(JSON.parse(sent?.[1]?.body ?? '{}')).toMatchObject({
    model: 'candidate-model',
    skills: ['research', 'writing'],
    candidates: [TAG_CANDIDATE, { id: 'working' }],
  });
});
it('explains a blocked comparison and opens connection settings directly', async () => {
  const compare = await start([], false);
  expect(compare.getByText('Connect this provider in Settings to run.')).toBeVisible();
  expect(compare.getByRole('button', { name: /^Run comparison/ })).toBeDisabled();
  fireEvent.click(compare.getByRole('button', { name: 'Connection settings' }));
  expect(openAppSettings).toHaveBeenCalledWith('settings', 'execution');
});
it('restores the prior version pair when reopening comparison', async () => {
  const previous = {
    ...CAPTURED_EVALUATION,
    candidates: [{ id: 'working', label: 'Current prompt', source: RUN_SOURCE }, TAG_CANDIDATE],
  };
  const compare = await start([previous]);
  expect(compare.getByRole('combobox', { name: 'A · Baseline' })).toHaveValue('working');
  expect(compare.getByRole('combobox', { name: 'B · Candidate' })).toHaveValue(TAG_CANDIDATE.id);
});
it('does not execute a comparison if saving its changed setup fails', async () => {
  const compare = await start();
  const respond = request.getMockImplementation()!;
  request.mockImplementation(async (path, init) => {
    if (path.endsWith('/profile') && init?.method === 'POST') throw new Error('Run setup could not be saved.');
    return respond(path, init);
  });
  fireEvent.change(compare.getByRole('searchbox'), { target: { value: 'writing' } });
  fireEvent.click(compare.getByRole('checkbox', { name: /Clear writing/ }));
  fireEvent.keyDown(compare.getByRole('searchbox'), { key: 'Enter', ctrlKey: true });
  await act(async () => {});
  expect(screen.getByRole('alert')).toHaveTextContent('Run setup could not be saved.');
  expect(request.mock.calls.some(([path, init]) => path.endsWith('/evaluations') && init?.method === 'POST')).toBe(
    false,
  );
  expect(compare.getByRole('searchbox')).toHaveValue('writing');
});
it('leaves composing input with its editor instead of starting a single run', async () => {
  await start();
  const tab = screen.getByRole('tab', { name: 'Single run' });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
  const field = within(screen.getByRole('tabpanel', { name: 'Single run' })).getByRole('textbox', {
    name: /User message/,
  });
  fireEvent.keyDown(field, { key: 'Enter', ctrlKey: true, isComposing: true });
  await act(async () => {});
  expect(request.mock.calls.some(([path, init]) => path === '/__studio/run' && init?.method === 'POST')).toBe(false);
});

it('brings a failed comparison action into keyboard focus without losing edited setup', async () => {
  const compare = await start();
  const respond = request.getMockImplementation()!;
  request.mockImplementation(async (path, init) => {
    if (path.endsWith('/profile') && init?.method === 'POST') throw new Error('Run setup could not be saved.');
    return respond(path, init);
  });
  const skillSearch = compare.getByRole('searchbox');
  fireEvent.change(skillSearch, { target: { value: 'writing' } });
  fireEvent.click(compare.getByRole('checkbox', { name: /Clear writing/ }));
  skillSearch.focus();
  fireEvent.keyDown(skillSearch, { key: 'Enter', ctrlKey: true });
  await act(async () => {});
  expect(screen.getByRole('alert')).toHaveFocus();
  expect(skillSearch).toHaveValue('writing');
});
it('preserves judge and tag drafts when reloading saved evaluations after an error', async () => {
  const compare = await start();
  fireEvent.click(compare.getByRole('checkbox', { name: 'Judge both answers' }));
  fireEvent.change(compare.getByRole('textbox', { name: 'Judge model' }), { target: { value: 'judge-model' } });
  fireEvent.change(compare.getByRole('textbox', { name: 'Judging rubric' }), { target: { value: 'Keep my rubric' } });
  fireEvent.click(compare.getByText('Save a Git version tag'));
  fireEvent.change(compare.getByRole('textbox', { name: 'New Git tag' }), { target: { value: 'draft-tag' } });
  const respond = request.getMockImplementation()!;
  request.mockImplementation(async (path, init) => {
    if (path.endsWith('/evaluations') && init?.method === 'POST') throw new Error('Request rejected');
    return respond(path, init);
  });
  fireEvent.click(compare.getByRole('button', { name: /^Run comparison/ }));
  await act(async () => {});
  fireEvent.click(screen.getByRole('button', { name: 'Reload saved evaluations' }));
  await act(async () => {});
  expect(compare.getByRole('textbox', { name: 'Judging rubric' })).toHaveValue('Keep my rubric');
  expect(compare.getByRole('textbox', { name: 'Judge model' })).toHaveValue('judge-model');
  expect(compare.getByRole('textbox', { name: 'New Git tag' })).toHaveValue('draft-tag');
});

it('clears a previous tag success message when a later tag save fails', async () => {
  const compare = await start();
  fireEvent.click(compare.getByText('Save a Git version tag'));
  fireEvent.change(compare.getByRole('textbox', { name: 'New Git tag' }), { target: { value: 'first-tag' } });
  fireEvent.click(compare.getByRole('button', { name: 'Create Git tag' }));
  await act(async () => {});
  expect(compare.getByText('Git tag “first-tag” created for the saved project.')).toBeVisible();
  const respond = request.getMockImplementation()!;
  request.mockImplementation(async (path, init) => {
    if (path.endsWith('/tags') && init?.method === 'POST') throw new Error('Tag already exists');
    return respond(path, init);
  });
  fireEvent.change(compare.getByRole('textbox', { name: 'New Git tag' }), { target: { value: 'first-tag' } });
  fireEvent.click(compare.getByRole('button', { name: 'Create Git tag' }));
  await act(async () => {});
  expect(screen.getByRole('alert')).toHaveTextContent('Tag already exists');
  expect(compare.queryByText('Git tag “first-tag” created for the saved project.')).not.toBeInTheDocument();
});

it('explains a blocked single run beside its action and links to model setup', async () => {
  await start([], false);
  const tab = screen.getByRole('tab', { name: 'Single run' });
  fireEvent.mouseDown(tab, { button: 0 });
  fireEvent.click(tab);
  const actions = within(screen.getByRole('region', { name: 'Single run actions' }));
  expect(actions.getByRole('status')).toHaveTextContent('Connect a model before running this prompt.');
  fireEvent.click(actions.getByRole('button', { name: 'Connect a model' }));
  expect(openAppSettings).toHaveBeenCalledWith('settings', 'execution');
  expect(request.mock.calls.some(([path, init]) => path === '/__studio/run' && init?.method === 'POST')).toBe(false);
});

it('edits one suite case at a time while preserving every case draft', async () => {
  const compare = await start();
  fireEvent.click(compare.getByRole('button', { name: 'New suite' }));
  fireEvent.change(compare.getByRole('textbox', { name: 'Test name' }), { target: { value: 'First case' } });
  fireEvent.change(compare.getByRole('textbox', { name: 'Test user message' }), {
    target: { value: 'Keep my case draft' },
  });
  fireEvent.click(compare.getByRole('button', { name: 'Add test' }));
  expect(compare.getAllByRole('textbox', { name: 'Test name' })).toHaveLength(1);
  expect(compare.getByRole('textbox', { name: 'Test name' })).toHaveValue('New test');
  fireEvent.click(compare.getByText('First case'));
  expect(compare.getByRole('textbox', { name: 'Test user message' })).toHaveValue('Keep my case draft');
  expect(request.mock.calls.some(([path, init]) => path.endsWith('/evaluations') && init?.method === 'POST')).toBe(
    false,
  );
});
