// @module-tag dom
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
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
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.useRealTimers();
});
function mockApi() {
  request.mockImplementation(async (path, init) => {
    if (init?.method === 'POST') {
      if (path.endsWith('/profile')) return { ok: true };
      if (path.endsWith('/settings')) return RUN_SETTINGS;
      if (path.endsWith('/suites')) return { suite: JSON.parse(init.body ?? '{}').suite };
      if (path.endsWith('/evaluations')) return { evaluation: CAPTURED_EVALUATION };
      if (path.endsWith('/tags')) return { ok: true };
      return { run: CAPTURED_RUN };
    }
    if (path.endsWith('/settings')) return RUN_SETTINGS;
    if (path.includes('/profile?')) return { profile: RUN_SETUP };
    if (path.includes('/suites?')) return { suites: [TEST_SUITE] };
    if (path.includes('/versions?')) return { versions: [TAG_CANDIDATE] };
    if (path.includes('/evaluations?')) return { evaluations: [] };
    return { runs: [] };
  });
}
async function start(draft = false) {
  mockApi();
  render(
    <RunWorkspace
      project={{ projectId: 'project-example', revision: 3 }}
      promptPath={CAPTURED_RUN.promptPath}
      source={RUN_SOURCE}
      draft={draft}
      projectPending={false}
      onClose={vi.fn()}
    />,
  );
  await screen.findByRole('button', { name: /^Run (draft|prompt)/ });
}
async function openTab(name: string) {
  const tab = screen.getByRole('tab', { name });
  fireEvent.mouseDown(tab, { button: 0, ctrlKey: false });
  fireEvent.click(tab);
  await act(async () => {});
  return within(screen.getByRole('tabpanel', { name }));
}

describe('RunWorkspace', () => {
  it('runs the writing snapshot with selected skills and retains the captured source beside its output', async () => {
    await start(true);
    fireEvent.click(screen.getByRole('button', { name: /^Run draft/ }));
    await screen.findByRole('region', { name: 'Model output' });
    const sent = request.mock.calls.find(([path, init]) => path === '/__studio/run' && init?.method === 'POST');
    expect(JSON.parse(sent?.[1]?.body ?? '{}')).toMatchObject({
      source: RUN_SOURCE,
      skills: ['research'],
      inputs: RUN_SETUP.inputs,
      projectId: 'project-example',
      revision: 3,
    });
    expect(JSON.parse(sent?.[1]?.body ?? '{}')).not.toHaveProperty('projectPending');
    expect(screen.getByRole('region', { name: 'Model output' })).toHaveTextContent('certified recycling facilities');
    act(() => announceRunSettings({ ...RUN_SETTINGS, model: 'another-model' }));
    expect(screen.getByText(/openai \/ configured-model/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Run source' })).toHaveTextContent('Research {{subject}}');
  });
  it('searches only discovered folder skills without making server requests', async () => {
    await start();
    fireEvent.click(screen.getByRole('button', { name: 'Edit skill attachments' }));
    const requestsBeforeSearch = request.mock.calls.length;
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'writing' } });
    expect(screen.queryByRole('checkbox', { name: /Research with evidence/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Clear writing/ }));
    expect(request.mock.calls).toHaveLength(requestsBeforeSearch);
  });
  it('saves guided test cases and compares an actual Git tag with the current draft using an explicit judge', async () => {
    await start(true);
    const tests = await openTab('Test suites');
    fireEvent.change(tests.getByLabelText(/Must include/), { target: { value: 'Source:\n\n' } });
    fireEvent.click(tests.getByRole('button', { name: 'Save suite' }));
    await act(async () => {});
    const save = request.mock.calls.find(([path, init]) => path.endsWith('/suites') && init?.method === 'POST');
    expect(JSON.parse(save?.[1]?.body ?? '{}').suite.cases[0].checks.contains).toEqual(['Source:']);
    const compare = await openTab('Compare');
    fireEvent.click(compare.getByRole('checkbox', { name: 'Judge both answers' }));
    fireEvent.change(compare.getByLabelText('Judge model'), { target: { value: 'judge-model' } });
    fireEvent.change(compare.getByLabelText('Judging rubric'), { target: { value: 'Prefer grounded answers.' } });
    fireEvent.click(compare.getByRole('button', { name: 'Run comparison' }));
    await act(async () => {});
    const sent = request.mock.calls.find(([path, init]) => path.endsWith('/evaluations') && init?.method === 'POST');
    expect(JSON.parse(sent?.[1]?.body ?? '{}')).toMatchObject({
      suiteId: TEST_SUITE.id,
      candidates: [TAG_CANDIDATE, { id: 'working', source: RUN_SOURCE }],
      judge: { model: 'judge-model', rubric: 'Prefer grounded answers.' },
    });
    expect(compare.getByText('LLM judge · Prefers B')).toBeInTheDocument();
    expect(compare.getByText('× Fail · Contains “Source:”')).toBeInTheDocument();
    expect(compare.getByText('✓ Pass · Contains “Source:”')).toBeInTheDocument();
    expect(compare.getByRole('button', { name: 'Create Git tag' })).toBeDisabled();
  });
  it('keeps unsaved judge edits when switching workspace tabs', async () => {
    await start();
    const compare = await openTab('Compare');
    fireEvent.click(compare.getByRole('checkbox', { name: 'Judge both answers' }));
    fireEvent.change(compare.getByLabelText('Judging rubric'), { target: { value: 'Keep this rubric.' } });
    await openTab('Single run');
    expect((await openTab('Compare')).getByLabelText('Judging rubric')).toHaveValue('Keep this rubric.');
  });
});

it('#2490: adopts app defaults without making an unchanged execution workspace dirty', async () => {
  await start();
  act(() => announceRunSettings({ ...RUN_SETTINGS, model: 'globally-updated-model' }));
  expect(screen.queryByText('Unsaved setup changes')).not.toBeInTheDocument();
  expect((await openTab('Settings')).getByText(/globally-updated-model/)).toBeVisible();
  expect(screen.queryByRole('textbox', { name: 'Model' })).not.toBeInTheDocument();
});
