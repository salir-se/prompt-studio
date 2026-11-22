// @module-tag dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { usePanelState } from './use-panel-state';
import { usePromptDraft, usePromptSaveShortcut } from './use-prompt-draft';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const initial = { rootId: 'research', text: 'Original instructions', originalText: 'Original instructions' };

it('keeps writing local until Apply and refuses to overwrite a newer source', () => {
  const onApply = vi.fn();
  const onError = vi.fn();
  const { result, rerender } = renderHook(({ document }) => usePromptDraft({ document, onApply, onError }), {
    initialProps: { document: initial },
  });
  act(() => result.current.change('My revised instructions'));
  expect(onApply).not.toHaveBeenCalled();
  act(() => result.current.apply());
  expect(onApply).toHaveBeenCalledWith('My revised instructions', 'edit prompt instructions');
  act(() => result.current.change('Unapplied instructions'));
  rerender({ document: { ...initial, text: 'Newer source from another editor' } });
  expect(result.current.text).toBe('Unapplied instructions');
  expect(result.current.stale).toBe(true);
  act(() => result.current.apply());
  expect(onApply).toHaveBeenCalledTimes(1);
  expect(onError).toHaveBeenCalledWith(expect.stringContaining('changed while you were writing'));
});

it('retains a draft when navigation is cancelled and discards it only after confirmation', () => {
  const confirm = vi.fn(() => false);
  vi.stubGlobal('confirm', confirm);
  const { result } = renderHook(() => {
    const draft = usePromptDraft({ document: initial, onApply: vi.fn(), onError: vi.fn() });
    return { draft, panels: usePanelState(draft) };
  });
  act(() => result.current.draft.change('Keep this work'));
  act(() => {
    result.current.panels.openPanel('variables');
  });
  expect(result.current.panels.activePanel).toBeNull();
  expect(result.current.draft.text).toBe('Keep this work');
  const exit = new Event('beforeunload', { cancelable: true });
  window.dispatchEvent(exit);
  expect(exit.defaultPrevented).toBe(true);
  confirm.mockReturnValue(true);
  act(() => {
    result.current.panels.openPanel('variables');
  });
  expect(result.current.panels.activePanel).toBe('variables');
  expect(result.current.draft.text).toBe(initial.text);
  expect(result.current.draft.dirty).toBe(false);
});

it('keeps resolver variants and documents separate', () => {
  const { result, rerender } = renderHook(
    ({ document }) => usePromptDraft({ document, onApply: vi.fn(), onError: vi.fn() }),
    { initialProps: { document: { ...initial, variantSymbol: 'one' } } },
  );
  act(() => result.current.change('Variant one draft'));
  rerender({ document: { ...initial, variantSymbol: 'two', text: 'Variant two source' } });
  expect(result.current.text).toBe('Variant two source');
  expect(result.current.dirty).toBe(false);
});

it.each(['dialog', 'menu'])('keeps the underlying panel open when Escape belongs to a nested %s', (role) => {
  const { result } = renderHook(() => usePanelState());
  act(() => {
    result.current.openPanel('variables');
  });
  const overlay = document.createElement('div');
  overlay.setAttribute('role', role);
  const input = document.createElement('input');
  overlay.append(input);
  document.body.append(overlay);
  try {
    act(() => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });
    expect(result.current.activePanel).toBe('variables');
  } finally {
    overlay.remove();
  }
});

it('leaves Save to IME composition before applying the active writing draft', () => {
  const apply = vi.fn();
  renderHook(() => usePromptSaveShortcut(true, { stale: false, apply }));
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, isComposing: true })));
  expect(apply).not.toHaveBeenCalled();
  act(() => document.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true })));
  expect(apply).toHaveBeenCalledTimes(1);
});

it.each(['role="dialog"', 'role="menu"', 'data-studio-panels'])(
  'leaves Save inside an overlay (%s) to that overlay',
  (attributes) => {
    const apply = vi.fn();
    renderHook(() => usePromptSaveShortcut(true, { stale: false, apply }));
    const container = document.createElement('div');
    container.innerHTML = `<div ${attributes}><input aria-label="Overlay input" /></div>`;
    document.body.append(container);
    try {
      act(() =>
        container
          .querySelector('input')!
          .dispatchEvent(new KeyboardEvent('keydown', { key: 's', ctrlKey: true, bubbles: true })),
      );
      expect(apply).not.toHaveBeenCalled();
    } finally {
      container.remove();
    }
  },
);
