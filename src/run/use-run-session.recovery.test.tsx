// @module-tag dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import { CAPTURED_RUN, RUN_SETTINGS, RUN_SETUP, RUN_SOURCE } from './run-fixtures';
import { useRunSession } from './use-run-session';

vi.mock('../prompt-repo/prompt-repo-client', () => ({ studioJson: vi.fn() }));
const request = vi.mocked(studioJson);
const scope = { projectId: 'project-example', revision: 3, promptPath: CAPTURED_RUN.promptPath, source: RUN_SOURCE };
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
it('recovers the accepted run when its start response is lost without starting another generation', async () => {
  let accepted: typeof CAPTURED_RUN | undefined;
  let starts = 0;
  request.mockImplementation(async (path, init) => {
    if (path === '/__studio/run/settings') return RUN_SETTINGS;
    if (path.startsWith('/__studio/run/profile')) return { profile: RUN_SETUP };
    if (path.startsWith('/__studio/run?')) return { runs: [] };
    if (path === '/__studio/run' && init?.method === 'POST') {
      starts++;
      accepted = { ...CAPTURED_RUN, runId: JSON.parse(init.body!).runId, status: 'running', finishedAt: undefined };
      throw new TypeError('Failed to fetch');
    }
    if (accepted && path.startsWith(`/__studio/run/${accepted.runId}?`)) return { run: accepted };
    throw new Error(`Unexpected request: ${path}`);
  });
  const { result } = renderHook(() => useRunSession(scope));
  await act(async () => {});
  await act(async () => {
    await result.current.run();
  });
  expect(result.current.selected?.runId).toBe(accepted?.runId);
  expect(result.current.running).toBe(true);
  expect(result.current.error).toBeNull();
  await act(async () => {
    await result.current.run();
  });
  expect(starts).toBe(1);
});

it('reuses the accepted request ID if both the start response and recovery lookup were lost', async () => {
  const starts: Array<{ runId: string; model: string }> = [];
  request.mockImplementation(async (path, init) => {
    if (path === '/__studio/run/settings') return RUN_SETTINGS;
    if (path.startsWith('/__studio/run/profile')) return { profile: RUN_SETUP };
    if (path.startsWith('/__studio/run?')) return { runs: [] };
    if (path === '/__studio/run' && init?.method === 'POST') {
      starts.push(JSON.parse(init.body!));
    }
    throw new TypeError('Failed to fetch');
  });
  const { result } = renderHook(() => useRunSession(scope));
  await act(async () => {});
  await act(async () => {
    await result.current.run();
  });
  expect(result.current.error).toContain('Failed to fetch');
  await act(async () => {
    await result.current.run();
  });
  expect(starts).toHaveLength(2);
  expect(starts[1].runId).toBe(starts[0].runId);
  act(() => result.current.setSetup({ ...RUN_SETUP, model: 'a-different-model' }));
  await act(async () => {
    await result.current.run();
  });
  expect(starts).toHaveLength(3);
  expect(starts[2].runId).not.toBe(starts[0].runId);
});

it('starts a new generation when the previous identical run was confirmed', async () => {
  const starts: string[] = [];
  request.mockImplementation(async (path, init) => {
    if (path === '/__studio/run/settings') return RUN_SETTINGS;
    if (path.startsWith('/__studio/run/profile')) return { profile: RUN_SETUP };
    if (path.startsWith('/__studio/run?')) return { runs: [] };
    if (path === '/__studio/run' && init?.method === 'POST') {
      const { runId } = JSON.parse(init.body!);
      starts.push(runId);
      return { run: { ...CAPTURED_RUN, runId } };
    }
    throw new Error(`Unexpected request: ${path}`);
  });
  const { result } = renderHook(() => useRunSession(scope));
  await act(async () => {});
  await act(async () => {
    await result.current.run();
  });
  await act(async () => {
    await result.current.run();
  });
  expect(starts).toHaveLength(2);
  expect(starts[1]).not.toBe(starts[0]);
});
