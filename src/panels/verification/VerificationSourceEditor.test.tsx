// @module-tag dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VerificationSourceEditor } from './VerificationSourceEditor';

it('waits for the durable writer before reporting a saved review and retains a failed draft', async () => {
  // Given: the durable save is still pending.
  let reject!: (error: Error) => void;
  const onSave = vi.fn(
    () =>
      new Promise<void>((_, fail) => {
        reject = fail;
      }),
  );
  const onRecheck = vi.fn();
  render(<VerificationSourceEditor text="Original" onSave={onSave} onRecheck={onRecheck} onDirtyChange={vi.fn()} />);
  const field = screen.getByRole('textbox', { name: 'Verification prompt source' });
  fireEvent.change(field, { target: { value: 'Retained repair' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save and recheck' }));
  // Then: a pending or failed write cannot be presented as a successful recheck.
  expect(field).toHaveAttribute('readonly');
  expect(onRecheck).not.toHaveBeenCalled();
  reject(new Error('Disk unavailable'));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Your draft is retained'));
  expect(field).toHaveValue('Retained repair');
  expect(screen.getByRole('button', { name: 'Save and recheck' })).toBeEnabled();
  expect(onRecheck).not.toHaveBeenCalled();
});

it('saves and rechecks exactly the repaired text through the keyboard', async () => {
  // Given: a valid source edit and the existing save boundary.
  const onSave = vi.fn().mockResolvedValue(undefined);
  const onRecheck = vi.fn();
  render(<VerificationSourceEditor text="Original" onSave={onSave} onRecheck={onRecheck} onDirtyChange={vi.fn()} />);
  const field = screen.getByRole('textbox', { name: 'Verification prompt source' });
  fireEvent.change(field, { target: { value: 'Exact repair' } });
  // When: the author uses the familiar save chord.
  fireEvent.keyDown(field, { key: 's', ctrlKey: true });
  // Then: source persistence precedes checking those exact bytes.
  await waitFor(() => expect(onRecheck).toHaveBeenCalledExactlyOnceWith('Exact repair'));
  expect(onSave).toHaveBeenCalledExactlyOnceWith('Exact repair');
  expect(screen.getByRole('status')).toHaveTextContent(/^Saved and rechecked$/);
});
