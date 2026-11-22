// @module-tag dom
import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VerificationRuleForm } from './VerificationRuleForm';

it('validates required text before creating a check and initializes its metadata', () => {
  // Given: an author creating a required-text check.
  const onSave = vi.fn();
  render(<VerificationRuleForm onSave={onSave} onCancel={vi.fn()} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add check' }));
  expect(onSave).not.toHaveBeenCalled();
  expect(screen.getByRole('alert')).toBeVisible();
  // When: the author supplies the requirement without editing IDs or JSON.
  fireEvent.change(screen.getByRole('textbox', { name: 'Required text' }), { target: { value: 'Evidence' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add check' }));
  // Then: a valid typed rule is ready for the existing persistence boundary.
  expect(onSave).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      id: expect.stringMatching(/^rule-/),
      kind: 'required-output-literal',
      literal: 'Evidence',
      severity: 'error',
      enforcement: 'edit',
    }),
  );
});

it('rejects an empty minimum instead of silently treating it as zero', () => {
  // Given: a minimum-length rule with an incomplete value.
  const onSave = vi.fn();
  render(<VerificationRuleForm onSave={onSave} onCancel={vi.fn()} />);
  fireEvent.change(screen.getByRole('combobox', { name: 'Check type' }), { target: { value: 'minimum-length' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add check' }));
  expect(onSave).not.toHaveBeenCalled();
  // When: an explicit zero is entered.
  fireEvent.change(screen.getByRole('spinbutton', { name: 'Minimum characters' }), { target: { value: '0' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add check' }));
  // Then: zero and missing input remain distinct.
  expect(onSave).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ kind: 'minimum-length', minChars: 0 }));
});
