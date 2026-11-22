// @module-tag dom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { PromptComposer } from './PromptComposer';

function Editor({ source }: { source: string }) {
  const [text, setText] = useState(source);
  return (
    <>
      <PromptComposer text={text} variables={['document']} tools={[]} onChange={setText} />
      <button type="button">After editor</button>
    </>
  );
}
const original = document.execCommand;
beforeEach(() => {
  document.execCommand = vi.fn(() => {
    const editor = document.activeElement as HTMLTextAreaElement;
    const command = vi.mocked(document.execCommand).mock.calls.at(-1)!;
    editor.setRangeText(String(command[2]), editor.selectionStart, editor.selectionEnd, 'end');
    return true;
  });
});
afterEach(() => {
  cleanup();
  document.execCommand = original;
});

it.each([
  ['alpha', 2, 2, false, 'forward', 'al  pha', 4, 4],
  ['one\ntwo\nthree', 1, 8, false, 'forward', '  one\n  two\nthree', 3, 12],
  ['one\ntwo\nthree', 1, 8, false, 'backward', '  one\n  two\nthree', 3, 12],
  ['one\ntwo', 0, 4, false, 'forward', '  one\ntwo', 2, 6],
  ['    alpha', 4, 4, true, 'forward', '  alpha', 2, 2],
  ['  one\n  two\nthree', 1, 12, true, 'backward', 'one\ntwo\nthree', 0, 8],
  ['\talpha', 1, 1, true, 'forward', 'alpha', 0, 0],
] as const)(
  '#2512: Tab edits indentation without replacing selected instructions (%j)',
  (source, start, end, shiftKey, direction, text, nextStart, nextEnd) => {
    render(<Editor source={source} />);
    const editor = screen.getByRole('textbox', { name: 'Prompt markdown' }) as HTMLTextAreaElement;
    act(() => {
      editor.focus();
      editor.setSelectionRange(start, end, direction);
    });
    fireEvent.select(editor);
    const event = new KeyboardEvent('keydown', { key: 'Tab', shiftKey, bubbles: true, cancelable: true });
    fireEvent(editor, event);
    expect(event.defaultPrevented).toBe(true);
    expect(editor.value).toBe(text);
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([nextStart, nextEnd]);
    if (nextStart !== nextEnd) expect(editor.selectionDirection).toBe(direction);
  },
);

it('#2512: Escape arms one native Tab to leave the editor', () => {
  render(<Editor source="Keep instructions" />);
  const editor = screen.getByRole('textbox', { name: 'Prompt markdown' });
  fireEvent.keyDown(editor, { key: 'Escape' });
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  fireEvent(editor, tab);
  expect(tab.defaultPrevented).toBe(false);
});

it.each([{ ctrlKey: true }, { altKey: true }, { metaKey: true }])(
  '#2512: modified Tab and Escape remain browser shortcuts (%j)',
  (keys) => {
    render(<Editor source="Instructions" />);
    const editor = screen.getByRole('textbox', { name: 'Prompt markdown' });
    for (const key of ['Tab', 'Escape']) {
      const event = new KeyboardEvent('keydown', { key, ...keys, bubbles: true, cancelable: true });
      fireEvent(editor, event);
      expect(event.defaultPrevented).toBe(false);
    }
  },
);

it('#2512: IME composition retains native Tab handling', () => {
  render(<Editor source="Instructions" />);
  const editor = screen.getByRole('textbox', { name: 'Prompt markdown' });
  const event = new KeyboardEvent('keydown', { key: 'Tab', isComposing: true, bubbles: true, cancelable: true });
  fireEvent(editor, event);
  expect(event.defaultPrevented).toBe(false);
});
