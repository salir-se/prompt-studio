// @module-tag dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { PromptWriter } from '../components/PromptWriter';
import { useStudioShortcuts } from './use-studio-shortcuts';

afterEach(cleanup);
const source = '<mission>\nKeep this unapplied instruction.\n</mission>';

function setup(allowed = true) {
  const changeView = vi.fn(() => allowed);
  const onApply = vi.fn();
  const onChange = vi.fn();
  function Workspace() {
    useStudioShortcuts({ enabled: true, explorer: vi.fn(), changeView, verify: vi.fn() });
    return (
      <>
        <button type="button">Workspace command</button>
        <PromptWriter
          text={source}
          dirty
          variables={[]}
          tools={[]}
          onChange={onChange}
          onApply={onApply}
          onDiscard={vi.fn()}
        />
      </>
    );
  }
  render(<Workspace />);
  return { changeView, onApply, onChange };
}

it.each(['Preview draft', 'Workspace command'])(
  '#2530: Alt+1 returns from Preview and focuses the existing editor from %s',
  async (origin) => {
    const user = userEvent.setup();
    const commands = setup();
    const editor = screen.getByRole('textbox', { name: 'Prompt markdown' }) as HTMLTextAreaElement;
    const selectionStart = source.indexOf('unapplied');
    editor.setSelectionRange(selectionStart, selectionStart + 9, 'backward');
    await user.click(screen.getByRole('tab', { name: 'Preview draft' }));
    expect(editor).not.toBeVisible();
    const target =
      origin === 'Preview draft'
        ? screen.getByRole('tab', { name: origin })
        : screen.getByRole('button', { name: origin });
    await user.click(target);
    fireEvent.keyDown(target, { code: 'Digit1', key: '1', altKey: true });
    await waitFor(() => expect(editor).toBeVisible());
    await waitFor(() => expect(editor).toHaveFocus());
    expect(screen.getByRole('tab', { name: 'Markdown' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: 'Prompt markdown' })).toBe(editor);
    expect(editor).toHaveValue(source);
    expect([editor.selectionStart, editor.selectionEnd, editor.selectionDirection]).toEqual([
      selectionStart,
      selectionStart + 9,
      'backward',
    ]);
    expect(commands.changeView).toHaveBeenCalledWith('write');
    expect(commands.onChange).not.toHaveBeenCalled();
    expect(commands.onApply).not.toHaveBeenCalled();
  },
);

it('#2530: leaves Preview and focus unchanged when the workspace navigation guard rejects Alt+1', async () => {
  const user = userEvent.setup();
  const commands = setup(false);
  const editor = screen.getByRole('textbox', { name: 'Prompt markdown' });
  const preview = screen.getByRole('tab', { name: 'Preview draft' });
  await user.click(preview);
  fireEvent.keyDown(preview, { code: 'Digit1', key: '1', altKey: true });
  expect(commands.changeView).toHaveBeenCalledWith('write');
  await act(
    async () => new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve()))),
  );
  expect(preview).toHaveAttribute('aria-selected', 'true');
  expect(preview).toHaveFocus();
  expect(editor).not.toBeVisible();
  expect(commands.onChange).not.toHaveBeenCalled();
  expect(commands.onApply).not.toHaveBeenCalled();
});
