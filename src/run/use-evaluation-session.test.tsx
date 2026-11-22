// @module-tag dom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import { CAPTURED_EVALUATION, RUN_SETUP, RUN_SOURCE, TAG_CANDIDATE, TEST_SUITE } from './run-fixtures';
import { useEvaluationSession } from './use-evaluation-session';

vi.mock('../prompt-repo/prompt-repo-client', () => ({ studioJson: vi.fn() }));
const request = vi.mocked(studioJson);
const secondSuite = { ...TEST_SUITE, id: 'suite-second', name: 'Second suite' };
const secondEvaluation = { ...CAPTURED_EVALUATION, id: 'evaluation-second', suite: secondSuite };

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

async function start() {
  request.mockImplementation(async (path) => {
    if (path.includes('/suites?')) return { suites: [TEST_SUITE, secondSuite] };
    if (path.includes('/evaluations?')) return { evaluations: [CAPTURED_EVALUATION, secondEvaluation] };
    return { versions: [TAG_CANDIDATE] };
  });
  const hook = renderHook(() =>
    useEvaluationSession({
      projectId: 'project-example',
      revision: 3,
      promptPath: TEST_SUITE.promptPath,
      source: RUN_SOURCE,
    }),
  );
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  return hook;
}

describe('evaluation refresh recovery', () => {
  it('keeps the workspace mounted and retains the selected suite and result while refreshing', async () => {
    const { result } = await start();
    act(() => {
      result.current.chooseSuite(secondSuite.id);
      result.current.setSelectedId(secondEvaluation.id);
    });
    let release!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.load();
    });
    expect(result.current.loading).toBe(false);
    await act(async () => {
      release({ suites: [TEST_SUITE, secondSuite] });
      await refresh;
    });
    expect(result.current.suite?.id).toBe(secondSuite.id);
    expect(result.current.selectedId).toBe(secondEvaluation.id);
  });

  it('preserves edits made during a delayed refresh and their discard baseline', async () => {
    const { result } = await start();
    let release!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.load();
    });
    act(() => {
      result.current.setSuite({ ...TEST_SUITE, name: 'Keep these edits' });
    });
    await act(async () => {
      release({ suites: [TEST_SUITE, secondSuite] });
      await refresh;
    });
    expect(result.current.suite?.name).toBe('Keep these edits');
    expect(result.current.dirty).toBe(true);
    act(() => result.current.discard());
    expect(result.current.suite).toEqual(TEST_SUITE);
    expect(result.current.dirty).toBe(false);
  });

  it('does not invalidate an in-flight save when refresh is requested', async () => {
    const { result } = await start();
    const edited = { ...TEST_SUITE, name: 'Saved edit' };
    act(() => result.current.setSuite(edited));
    let release!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let save!: Promise<void>;
    act(() => {
      save = result.current.saveSuite();
    });
    await act(async () => {
      await result.current.load();
    });
    await act(async () => {
      release({ suite: edited });
      await save;
    });
    expect(result.current.busy).toBe(false);
    expect(result.current.suite).toEqual(edited);
    expect(result.current.dirty).toBe(false);
  });

  it('recovers an accepted evaluation when its start response is lost without starting another', async () => {
    const { result } = await start();
    const started = { ...CAPTURED_EVALUATION, id: crypto.randomUUID() };
    request.mockImplementation(async (_path, init) => {
      if (init?.method === 'POST') {
        started.id = JSON.parse(init.body ?? '{}').id;
        throw new TypeError('Network connection lost after accepting evaluation');
      }
      return { evaluation: started };
    });
    await act(async () => {
      await result.current.evaluate(CAPTURED_EVALUATION.candidates, RUN_SETUP);
    });
    expect(result.current.selected?.id).toBe(started.id);
    expect(result.current.error).toBeNull();
    const posts = request.mock.calls.filter(([, init]) => init?.method === 'POST');
    expect(posts).toHaveLength(1);
  });

  it('reuses the same request identity after both starting and recovery responses are lost', async () => {
    const { result } = await start();
    const started = { ...CAPTURED_EVALUATION, id: crypto.randomUUID() };
    let postCount = 0;
    request.mockImplementation(async (_path, init) => {
      if (init?.method === 'POST') {
        const sent = JSON.parse(init.body ?? '{}');
        if (postCount++ > 0) return { evaluation: { ...started, id: sent.id } };
      }
      throw new TypeError('Connection unavailable');
    });
    await act(async () => {
      await result.current.evaluate(CAPTURED_EVALUATION.candidates, RUN_SETUP);
    });
    expect(result.current.error).toBe('Connection unavailable');
    await act(async () => {
      await result.current.evaluate(CAPTURED_EVALUATION.candidates, RUN_SETUP);
    });
    const ids = request.mock.calls
      .filter(([, init]) => init?.method === 'POST')
      .map(([, init]) => JSON.parse(init?.body ?? '{}').id);
    expect(ids).toHaveLength(2);
    expect(ids[1]).toBe(ids[0]);
    expect(result.current.selected?.id).toBe(ids[0]);
  });

  it('does not let an older refresh replace a newly started evaluation', async () => {
    const { result } = await start();
    let release!: (value: unknown) => void;
    request.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        }),
    );
    let refresh!: Promise<void>;
    act(() => {
      refresh = result.current.load();
    });
    const started = { ...CAPTURED_EVALUATION, id: 'new-evaluation' };
    request.mockResolvedValueOnce({ evaluation: started });
    await act(async () => {
      await result.current.evaluate(CAPTURED_EVALUATION.candidates, RUN_SETUP);
    });
    expect(result.current.selected?.id).toBe(started.id);
    await act(async () => {
      release({ suites: [TEST_SUITE, secondSuite] });
      await refresh;
    });
    expect(result.current.selected?.id).toBe(started.id);
    expect(result.current.evaluations).toContainEqual(started);
  });

  it('starts a different request when the saved cases changed after an unconfirmed start', async () => {
    const { result } = await start();
    const started = { ...CAPTURED_EVALUATION };
    request.mockImplementation(async (path, init) => {
      if (init?.method === 'POST' && path.endsWith('/suites')) {
        return { suite: JSON.parse(init.body ?? '{}').suite };
      }
      if (init?.method === 'POST') started.id = JSON.parse(init.body ?? '{}').id;
      throw new TypeError('Connection unavailable');
    });
    await act(async () => {
      await result.current.evaluate(CAPTURED_EVALUATION.candidates, RUN_SETUP);
    });
    const firstId = started.id;
    act(() => {
      result.current.setSuite({
        ...TEST_SUITE,
        cases: TEST_SUITE.cases.map((entry) => ({ ...entry, userMessage: 'A different test request' })),
      });
    });
    await act(async () => {
      await result.current.saveSuite();
    });
    await act(async () => {
      await result.current.evaluate(CAPTURED_EVALUATION.candidates, RUN_SETUP);
    });
    expect(started.id).not.toBe(firstId);
  });

  it('starts a fresh evaluation after refresh recovers the previously unconfirmed result', async () => {
    const { result } = await start();
    const ids: string[] = [];
    request.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') {
        const id = JSON.parse(init.body ?? '{}').id;
        ids.push(id);
        if (ids.length === 1) throw new TypeError('Lost start response');
        return { evaluation: { ...CAPTURED_EVALUATION, id } };
      }
      if (path.includes('/suites?')) return { suites: [TEST_SUITE] };
      if (path.includes('/evaluations?')) {
        return { evaluations: [{ ...CAPTURED_EVALUATION, id: ids[0] }] };
      }
      if (path.includes('/versions?')) return { versions: [TAG_CANDIDATE] };
      throw new TypeError('Lost recovery response');
    });
    await act(async () => {
      await result.current.evaluate(CAPTURED_EVALUATION.candidates, RUN_SETUP);
    });
    await act(async () => {
      await result.current.load();
    });
    expect(result.current.selected?.id).toBe(ids[0]);
    await act(async () => {
      await result.current.evaluate(CAPTURED_EVALUATION.candidates, RUN_SETUP);
    });
    expect(ids[1]).not.toBe(ids[0]);
    expect(result.current.evaluations).toHaveLength(2);
  });
});
