// @module-tag dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptWriter } from './PromptWriter';

afterEach(cleanup);
it('does not apply a draft when Save or Enter belongs to IME composition', () => {
  const onApply = vi.fn();
  render(
    <PromptWriter
      text="Original"
      dirty
      variables={[]}
      tools={[]}
      onChange={vi.fn()}
      onApply={onApply}
      onDiscard={vi.fn()}
    />,
  );
  const editor = screen.getByRole('textbox', { name: 'Prompt markdown' });
  fireEvent.keyDown(editor, { key: 'Enter', ctrlKey: true, isComposing: true });
  fireEvent.keyDown(editor, { key: 's', ctrlKey: true, isComposing: true });
  expect(onApply).not.toHaveBeenCalled();
});

it('lets the completion menu own Enter, Tab and Escape without applying the draft', async () => {
  const onApply = vi.fn();
  render(
    <PromptWriter
      text="{{doc"
      dirty
      variables={['document']}
      tools={[]}
      onChange={vi.fn()}
      onApply={onApply}
      onDiscard={vi.fn()}
    />,
  );
  const editor = screen.getByRole('textbox', { name: 'Prompt markdown' }) as HTMLTextAreaElement;
  editor.setSelectionRange(5, 5);
  fireEvent.focus(editor);
  await waitFor(() => expect(screen.getByRole('listbox', { name: 'Prompt suggestions' })).toBeVisible());
  fireEvent.keyDown(editor, { key: 'Escape' });
  expect(screen.queryByRole('listbox', { name: 'Prompt suggestions' })).not.toBeInTheDocument();
  const tab = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true });
  editor.dispatchEvent(tab);
  expect(tab.defaultPrevented).toBe(false);
  expect(onApply).not.toHaveBeenCalled();
});

it('keeps source selection shortcuts available while suggestions are open', () => {
  render(
    <PromptWriter
      text="{{doc"
      dirty
      variables={['document']}
      tools={[]}
      onChange={vi.fn()}
      onApply={vi.fn()}
      onDiscard={vi.fn()}
    />,
  );
  const editor = screen.getByRole('textbox', { name: 'Prompt markdown' }) as HTMLTextAreaElement;
  editor.setSelectionRange(5, 5);
  fireEvent.focus(editor);
  const select = new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true, cancelable: true });
  act(() => editor.dispatchEvent(select));
  expect(select.defaultPrevented).toBe(false);
});

it('starts each keyboard section jump with the full draft outline', async () => {
  const user = userEvent.setup();
  render(
    <PromptWriter
      text={'<mission>\nTask\n</mission>\n<output>\nResult\n</output>'}
      dirty
      variables={[]}
      tools={[]}
      onChange={vi.fn()}
      onApply={vi.fn()}
      onDiscard={vi.fn()}
    />,
  );
  const editor = screen.getByRole('textbox', { name: 'Prompt markdown' });
  fireEvent.keyDown(editor, { key: 'j', code: 'KeyJ', altKey: true });
  expect(await screen.findByRole('option', { name: /mission/ })).toBeVisible();
  await user.type(screen.getByRole('combobox', { name: 'Find section' }), 'output');
  expect(screen.getByRole('option', { name: /output/ })).toBeVisible();
  expect(screen.queryByRole('option', { name: /mission/ })).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.keyDown(editor, { key: 'j', code: 'KeyJ', altKey: true });
  expect(screen.getByRole('option', { name: /mission/ })).toBeVisible();
});

it('#2534: search and adjacent-section shortcuts focus same-line label instructions without changing the draft', async () => {
  const user = userEvent.setup();
  const text = 'MISSION: Write a short answer.\n\nOUTPUT: JSON only.';
  const onChange = vi.fn();
  const onApply = vi.fn();
  render(
    <PromptWriter
      text={text}
      dirty
      variables={[]}
      tools={[]}
      onChange={onChange}
      onApply={onApply}
      onDiscard={vi.fn()}
    />,
  );
  const editor = screen.getByRole('textbox', { name: 'Prompt markdown' }) as HTMLTextAreaElement;
  fireEvent.keyDown(editor, { key: 'j', code: 'KeyJ', altKey: true });
  await user.click(await screen.findByRole('option', { name: /MISSION/ }));
  await waitFor(() => expect(editor).toHaveFocus());
  expect(editor.selectionStart).toBe(text.indexOf('Write'));
  expect(editor.selectionEnd).toBe(editor.selectionStart);
  fireEvent.keyDown(editor, { key: 'ArrowDown', altKey: true });
  expect(editor.selectionStart).toBe(text.indexOf('JSON'));
  expect(editor).toHaveFocus();
  fireEvent.keyDown(editor, { key: 'ArrowUp', altKey: true });
  expect(editor.selectionStart).toBe(text.indexOf('Write'));
  expect(editor).toHaveValue(text);
  expect(onChange.mock.calls.every(([value]) => value === text)).toBe(true);
  expect(onApply).not.toHaveBeenCalled();
});

it('keeps the native editor mounted when previewing and returning to the draft', async () => {
  const user = userEvent.setup();
  render(
    <PromptWriter
      text={'<mission>\nOriginal\n</mission>'}
      dirty
      variables={[]}
      tools={[]}
      onChange={vi.fn()}
      onApply={vi.fn()}
      onDiscard={vi.fn()}
    />,
  );
  const editor = screen.getByRole('textbox', { name: 'Prompt markdown' });
  await user.click(screen.getByRole('tab', { name: 'Preview draft' }));
  await user.click(screen.getByRole('tab', { name: 'Markdown' }));
  expect(screen.getByRole('textbox', { name: 'Prompt markdown' })).toBe(editor);
});

it('lets subsection insertion own Ctrl+Enter in its form', async () => {
  const user = userEvent.setup();
  const onApply = vi.fn();
  render(
    <PromptWriter
      text={'<mission>\nOriginal\n</mission>'}
      dirty
      variables={[]}
      tools={[]}
      onChange={vi.fn()}
      onApply={onApply}
      onDiscard={vi.fn()}
    />,
  );
  await user.click(screen.getByRole('button', { name: '+ Section' }));
  const input = screen.getByRole('textbox', { name: 'Section name' });
  await user.type(input, 'details');
  const insert = new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true, cancelable: true });
  act(() => input.dispatchEvent(insert));
  expect(insert.defaultPrevented).toBe(true);
  expect(onApply).not.toHaveBeenCalled();
});

it.each([
  { key: 'ArrowUp', altKey: true, shiftKey: true },
  { key: 'ArrowDown', altKey: true, shiftKey: true },
  { key: 'j', code: 'KeyJ', altKey: true, shiftKey: true },
  { key: ' ', code: 'Space', metaKey: true },
])('leaves modified native shortcuts to the browser: %j', (keys) => {
  render(
    <PromptWriter
      text={'<mission>\nOriginal\n</mission>'}
      dirty
      variables={[]}
      tools={[]}
      onChange={vi.fn()}
      onApply={vi.fn()}
      onDiscard={vi.fn()}
    />,
  );
  const editor = screen.getByRole('textbox', { name: 'Prompt markdown' });
  const shortcut = new KeyboardEvent('keydown', { ...keys, bubbles: true, cancelable: true });
  act(() => editor.dispatchEvent(shortcut));
  expect(shortcut.defaultPrevented).toBe(false);
  expect(screen.queryByRole('dialog', { name: 'Jump to section' })).not.toBeInTheDocument();
});
