// @module-tag dom
import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePanelState } from './use-panel-state';

afterEach(() => vi.unstubAllGlobals());
it('opens and closes Run without discarding the writing draft it evaluates', () => {
  const discard = vi.fn();
  vi.stubGlobal(
    'confirm',
    vi.fn(() => false),
  );
  const { result } = renderHook(() => usePanelState({ dirty: true, discard }));
  act(() => {
    expect(result.current.openPanel('run')).toBe(true);
  });
  expect(result.current.activePanel).toBe('run');
  act(() => {
    expect(result.current.dismissPanel()).toBe(true);
  });
  expect(discard).not.toHaveBeenCalled();
  expect(window.confirm).not.toHaveBeenCalled();
  act(() => {
    expect(result.current.confirmDiscard()).toBe(false);
  });
  expect(window.confirm).toHaveBeenCalledOnce();
});

it('requires a writing discard decision when navigating away from an open Run', () => {
  const discard = vi.fn();
  vi.stubGlobal(
    'confirm',
    vi.fn(() => false),
  );
  const { result } = renderHook(() => usePanelState({ dirty: true, discard }));
  act(() => {
    result.current.openPanel('run');
  });
  act(() => {
    expect(result.current.closePanel()).toBe(false);
  });
  expect(result.current.activePanel).toBe('run');
  expect(discard).not.toHaveBeenCalled();
});

it('#2490: toggles evaluations without discarding unfinished tests, while retaining unload protection', () => {
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  const { result } = renderHook(() => usePanelState());
  expect(result.current).toHaveProperty('toggleEvaluations');
  act(() => {
    result.current.toggleEvaluations();
  });
  act(() => {
    result.current.onDirtyChange(true);
  });
  act(() => {
    result.current.toggleEvaluations();
  });
  expect(result.current.activePanel).toBeNull();
  expect(result.current.retainedEvaluation).toBe(true);
  expect(result.current.modal).toBe(false);
  expect(confirm).not.toHaveBeenCalled();
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(true);
  act(() => {
    result.current.toggleEvaluations();
  });
  expect(result.current.activePanel).toBe('evaluate');
  act(() => {
    expect(result.current.openPanel('design')).toBe(false);
  });
  expect(confirm).toHaveBeenCalledOnce();
  expect(result.current.activePanel).toBe('evaluate');
});

it.each([
  { hidden: false, accept: false },
  { hidden: false, accept: true },
  { hidden: true, accept: false },
  { hidden: true, accept: true },
])('#2490: discards evaluation edits only after accepting (hidden: $hidden, accept: $accept)', ({ hidden, accept }) => {
  const confirm = vi.fn(() => accept);
  vi.stubGlobal('confirm', confirm);
  const { result } = renderHook(() => usePanelState());
  act(() => {
    result.current.toggleEvaluations();
  });
  act(() => {
    result.current.onDirtyChange(true);
  });
  if (hidden) {
    act(() => {
      result.current.toggleEvaluations();
    });
  }
  expect(result.current.activePanel).toBe(hidden ? null : 'evaluate');
  act(() => {
    expect(result.current.confirmDiscard()).toBe(accept);
  });
  expect(confirm).toHaveBeenCalledOnce();
  expect(result.current.retainedEvaluation).toBe(!accept);
  const unload = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(unload);
  expect(unload.defaultPrevented).toBe(!accept);
  if (!accept && hidden) {
    act(() => {
      result.current.toggleEvaluations();
    });
    expect(result.current.activePanel).toBe('evaluate');
  }
});

it('#2490: retains a clean hidden evaluation while composing the prompt', () => {
  vi.stubGlobal('confirm', vi.fn());
  const { result } = renderHook(() => usePanelState());
  act(() => {
    result.current.toggleEvaluations();
  });
  act(() => {
    result.current.toggleEvaluations();
  });
  act(() => {
    expect(result.current.confirmDiscard()).toBe(true);
  });
  expect(result.current.activePanel).toBeNull();
  expect(result.current.retainedEvaluation).toBe(true);
  expect(window.confirm).not.toHaveBeenCalled();
});

it('#2530: returning to Write retains dirty prompt instructions while preserving reference and panel guards', () => {
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  const discardWriting = vi.fn();
  const discardReference = vi.fn();
  const { result, rerender } = renderHook(
    ({ referenceDirty }) =>
      usePanelState({ dirty: true, discard: discardWriting }, { dirty: referenceDirty, discard: discardReference }),
    { initialProps: { referenceDirty: true } },
  );
  act(() => expect(result.current.closePanelKeepingWriting()).toBe(false));
  expect(confirm).toHaveBeenLastCalledWith('Discard unsaved referenced-file changes? Choose Cancel to keep editing.');
  expect(discardWriting).not.toHaveBeenCalled();
  expect(discardReference).not.toHaveBeenCalled();
  rerender({ referenceDirty: false });
  confirm.mockClear();
  act(() => result.current.onDirtyChange(true));
  act(() => expect(result.current.closePanelKeepingWriting()).toBe(false));
  expect(confirm).toHaveBeenLastCalledWith('Discard unsaved changes in this panel? Choose Cancel to keep editing.');
  expect(discardWriting).not.toHaveBeenCalled();
  expect(discardReference).not.toHaveBeenCalled();
  act(() => result.current.onDirtyChange(false));
  confirm.mockClear();
  act(() => expect(result.current.closePanelKeepingWriting()).toBe(true));
  expect(confirm).not.toHaveBeenCalled();
  expect(discardWriting).not.toHaveBeenCalled();
});
