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
  vi.useRealTimers();
});
function initial(runs: unknown[] = []) {
  request
    .mockResolvedValueOnce(RUN_SETTINGS)
    .mockResolvedValueOnce({ profile: RUN_SETUP })
    .mockResolvedValueOnce({ runs });
}
it('polls a saved running record through completion and stops requesting it afterwards', async () => {
  vi.useFakeTimers();
  initial([{ ...CAPTURED_RUN, status: 'running', output: '', finishedAt: undefined }]);
  const { result } = renderHook(() => useRunSession(scope));
  await act(async () => {});
  request.mockResolvedValueOnce({ run: CAPTURED_RUN });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
  expect(result.current.selected?.output).toContain('certified recycling');
  expect(result.current.running).toBe(false);
  const calls = request.mock.calls.length;
  await act(async () => {
    await vi.advanceTimersByTimeAsync(5000);
  });
  expect(request).toHaveBeenCalledTimes(calls);
});
it('refreshes after cancel and keeps polling until the interrupted output has been captured', async () => {
  vi.useFakeTimers();
  initial([{ ...CAPTURED_RUN, status: 'running', output: '', finishedAt: undefined }]);
  const { result } = renderHook(() => useRunSession(scope));
  await act(async () => {});
  request
    .mockResolvedValueOnce({ ok: true })
    .mockResolvedValueOnce({ run: { ...CAPTURED_RUN, status: 'cancelled', finishedAt: undefined, output: '' } });
  await act(async () => {
    await result.current.cancel(CAPTURED_RUN.runId);
  });
  expect(result.current.running).toBe(true);
  request.mockResolvedValueOnce({
    run: { ...CAPTURED_RUN, status: 'cancelled', output: 'Partial response retained.' },
  });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
  expect(result.current.selected?.output).toBe('Partial response retained.');
  expect(result.current.running).toBe(false);
});
it('retries a poll failure without losing captured history or relabeling its model', async () => {
  vi.useFakeTimers();
  initial([{ ...CAPTURED_RUN, status: 'running', output: '', finishedAt: undefined }]);
  const { result } = renderHook(() => useRunSession(scope));
  await act(async () => {});
  request.mockRejectedValueOnce(new Error('Offline'));
  await act(async () => {
    await vi.advanceTimersByTimeAsync(700);
  });
  expect(result.current.pollError).toContain('Retrying automatically');
  expect(result.current.runs).toHaveLength(1);
  request.mockResolvedValueOnce({ run: CAPTURED_RUN });
  await act(async () => {
    await vi.advanceTimersByTimeAsync(1000);
  });
  expect(result.current.pollError).toBeNull();
  expect(result.current.selected?.model).toBe('configured-model');
});
it('does not start two chargeable requests from repeated shortcuts in the same event turn', async () => {
  initial();
  const { result } = renderHook(() => useRunSession(scope));
  await act(async () => {});
  let save: (value: unknown) => void = () => {};
  request.mockImplementation(async (path) =>
    path.endsWith('/profile')
      ? new Promise((resolve) => {
          save = resolve;
        })
      : { run: CAPTURED_RUN },
  );
  let first: Promise<void> = Promise.resolve();
  let second: Promise<void> = Promise.resolve();
  act(() => {
    first = result.current.run();
    second = result.current.run();
  });
  expect(
    request.mock.calls.filter(([path, init]) => path.endsWith('/profile') && init?.method === 'POST'),
  ).toHaveLength(1);
  await act(async () => {
    save({ ok: true });
    await Promise.all([first, second]);
  });
  expect(request.mock.calls.filter(([path]) => path === '/__studio/run')).toHaveLength(1);
});

it('#2490: inherits app model defaults even when a saved prompt profile has an older model', async () => {
  request
    .mockResolvedValueOnce({ ...RUN_SETTINGS, model: 'app-default-model' })
    .mockResolvedValueOnce({ profile: { ...RUN_SETUP, model: 'old-model' } })
    .mockResolvedValueOnce({ runs: [CAPTURED_RUN] });
  const { result } = renderHook(() => useRunSession(scope));
  await act(async () => {});
  expect(result.current.setup.model).toBe('app-default-model');
  expect(result.current.setup.inputs).toEqual(RUN_SETUP.inputs);
  expect(result.current.setup.skills).toEqual(RUN_SETUP.skills);
  expect(result.current.selected?.model).toBe(CAPTURED_RUN.model);
  expect(result.current.dirty).toBe(false);
});

it('#2490: adopts changed application defaults without resetting test inputs, skill selection or saved outputs', async () => {
  initial([CAPTURED_RUN]);
  const { result } = renderHook(() => useRunSession(scope));
  await act(async () => {});
  act(() =>
    result.current.setSetup({ ...result.current.setup, inputs: { subject: 'Unsaved case' }, skills: ['new-skill'] }),
  );
  const calls = request.mock.calls.length;
  act(() =>
    window.dispatchEvent(
      new CustomEvent('studio:run-settings-changed', { detail: { ...RUN_SETTINGS, model: 'new-global-model' } }),
    ),
  );
  expect(result.current.setup.model).toBe('new-global-model');
  expect(result.current.setup.inputs).toEqual({ subject: 'Unsaved case' });
  expect(result.current.setup.skills).toEqual(['new-skill']);
  expect(result.current.selected?.output).toBe(CAPTURED_RUN.output);
  expect(result.current.dirty).toBe(true);
  expect(request).toHaveBeenCalledTimes(calls);
});

it('#2490: keeps settings saved while an older setup load is still pending', async () => {
  let finishSettings: (value: typeof RUN_SETTINGS) => void = () => {};
  request
    .mockResolvedValueOnce(
      new Promise<typeof RUN_SETTINGS>((resolve) => {
        finishSettings = resolve;
      }),
    )
    .mockResolvedValueOnce({ profile: RUN_SETUP })
    .mockResolvedValueOnce({ runs: [] });
  const { result } = renderHook(() => useRunSession(scope));
  await act(async () => {});
  act(() =>
    window.dispatchEvent(
      new CustomEvent('studio:run-settings-changed', { detail: { ...RUN_SETTINGS, model: 'newest-model' } }),
    ),
  );
  await act(async () => {
    finishSettings(RUN_SETTINGS);
  });
  expect(result.current.setup.model).toBe('newest-model');
  expect(result.current.settings?.model).toBe('newest-model');
  expect(result.current.dirty).toBe(false);
});
