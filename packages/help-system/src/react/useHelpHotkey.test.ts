// @module-tag dom
import { fireEvent, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { useHelpHotkey } from './useHelpHotkey';

describe('useHelpHotkey', () => {
  it("toggles when '?' is pressed outside an editable element", () => {
    const onToggle = vi.fn();
    renderHook(() => useHelpHotkey({ onToggle }));

    fireEvent.keyDown(document.body, { key: '?' });

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("toggles when 'F1' is pressed", () => {
    const onToggle = vi.fn();
    renderHook(() => useHelpHotkey({ onToggle }));

    fireEvent.keyDown(document.body, { key: 'F1' });

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("ignores '?' while typing in an input, but 'F1' still toggles there", () => {
    const onToggle = vi.fn();
    renderHook(() => useHelpHotkey({ onToggle }));

    const input = document.createElement('input');
    document.body.appendChild(input);

    fireEvent.keyDown(input, { key: '?' });
    expect(onToggle).not.toHaveBeenCalled();

    fireEvent.keyDown(input, { key: 'F1' });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('ignores both keys when disabled', () => {
    const onToggle = vi.fn();
    renderHook(() => useHelpHotkey({ onToggle, enabled: false }));

    fireEvent.keyDown(document.body, { key: '?' });
    fireEvent.keyDown(document.body, { key: 'F1' });

    expect(onToggle).not.toHaveBeenCalled();
  });

  it("with hotkey false, '?' does nothing but 'F1' still toggles", () => {
    const onToggle = vi.fn();
    renderHook(() => useHelpHotkey({ onToggle, hotkey: false }));

    fireEvent.keyDown(document.body, { key: '?' });
    expect(onToggle).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: 'F1' });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('honors a custom hotkey', () => {
    const onToggle = vi.fn();
    renderHook(() => useHelpHotkey({ onToggle, hotkey: 'h' }));

    fireEvent.keyDown(document.body, { key: '?' });
    expect(onToggle).not.toHaveBeenCalled();

    fireEvent.keyDown(document.body, { key: 'h' });
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('uses the latest onToggle without re-binding the listener', () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ cb }) => useHelpHotkey({ onToggle: cb }), {
      initialProps: { cb: first },
    });

    rerender({ cb: second });
    fireEvent.keyDown(document.body, { key: 'F1' });

    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('removes the listener on unmount', () => {
    const onToggle = vi.fn();
    const { unmount } = renderHook(() => useHelpHotkey({ onToggle }));

    unmount();
    fireEvent.keyDown(document.body, { key: 'F1' });

    expect(onToggle).not.toHaveBeenCalled();
  });
});
