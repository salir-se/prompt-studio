// @module-tag dom
/**
 * BDD tests for FragmentEditDialog.
 *
 * Behaviour contracts:
 *  - Apply calls onApply with the EDITED text.
 *  - Cancel discards the draft — onApply is never called.
 *  - Re-opening re-seeds the draft from a NEW initialText (no leakage between sessions).
 *  - Apply is disabled while the draft is unchanged from initialText.
 *  - The Raw/Rendered toggle switches between the highlighted editor and the read-only preview.
 *  - The Rendered preview reflects the current DRAFT, not the original initialText.
 */

import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { FragmentEditDialog } from './FragmentEditDialog';

describe('FragmentEditDialog', () => {
  it('calls onApply with the edited text when Apply is pressed', () => {
    const onApply = vi.fn();
    render(
      <FragmentEditDialog
        open
        title="Your Mission"
        initialText="Find companies."
        onApply={onApply}
        onCancel={() => {}}
      />,
    );

    const textarea = screen.getByRole('textbox', { name: 'Your Mission markdown' });
    fireEvent.change(textarea, { target: { value: 'Find companies with delegation-ready signals.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    expect(onApply).toHaveBeenCalledWith('Find companies with delegation-ready signals.');
  });

  it('discards the draft on Cancel — onApply is never called', () => {
    const onApply = vi.fn();
    const onCancel = vi.fn();
    render(
      <FragmentEditDialog
        open
        title="Your Mission"
        initialText="Find companies."
        onApply={onApply}
        onCancel={onCancel}
      />,
    );

    const textarea = screen.getByRole('textbox', { name: 'Your Mission markdown' });
    fireEvent.change(textarea, { target: { value: 'edited but abandoned' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onApply).not.toHaveBeenCalled();
  });

  it('disables Apply while the draft is unchanged from initialText', () => {
    render(
      <FragmentEditDialog
        open
        title="Your Mission"
        initialText="Find companies."
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('enables Apply once the draft diverges from initialText', () => {
    render(
      <FragmentEditDialog
        open
        title="Your Mission"
        initialText="Find companies."
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    const textarea = screen.getByRole('textbox', { name: 'Your Mission markdown' });
    fireEvent.change(textarea, { target: { value: 'Find companies now.' } });
    expect(screen.getByRole('button', { name: 'Apply' })).toBeEnabled();
  });

  it('re-seeds the draft from a new initialText on re-open (no leakage between sessions)', () => {
    const onApply = vi.fn();
    const { rerender } = render(
      <FragmentEditDialog
        open
        title="Your Mission"
        initialText="First session text."
        onApply={onApply}
        onCancel={() => {}}
      />,
    );

    // Edit, then close WITHOUT applying (simulating Cancel/Escape closing it from outside).
    fireEvent.change(screen.getByRole('textbox', { name: 'Your Mission markdown' }), {
      target: { value: 'abandoned edit from first session' },
    });
    rerender(
      <FragmentEditDialog
        open={false}
        title="Your Mission"
        initialText="First session text."
        onApply={onApply}
        onCancel={() => {}}
      />,
    );

    // Re-open with a DIFFERENT initialText (e.g. another section was edited elsewhere).
    rerender(
      <FragmentEditDialog
        open
        title="Your Mission"
        initialText="Second session text."
        onApply={onApply}
        onCancel={() => {}}
      />,
    );

    const textarea = screen.getByRole('textbox', { name: 'Your Mission markdown' }) as HTMLTextAreaElement;
    expect(textarea.value).toBe('Second session text.');
    expect(screen.getByRole('button', { name: 'Apply' })).toBeDisabled();
  });

  it('switches from the Raw highlighted editor to the Rendered preview via the mode toggle', () => {
    render(
      <FragmentEditDialog
        open
        title="Your Mission"
        initialText="**bold** text"
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );

    expect(screen.getByRole('textbox', { name: 'Your Mission markdown' })).toBeInTheDocument();
    expect(screen.queryByTestId('fragment-edit-dialog-rendered')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Rendered' }));

    expect(screen.queryByRole('textbox', { name: 'Your Mission markdown' })).not.toBeInTheDocument();
    expect(screen.getByTestId('fragment-edit-dialog-rendered')).toBeInTheDocument();
  });

  it('renders the current DRAFT (not initialText) in the Rendered preview', () => {
    render(
      <FragmentEditDialog
        open
        title="Your Mission"
        initialText="original text"
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );

    fireEvent.change(screen.getByRole('textbox', { name: 'Your Mission markdown' }), {
      target: { value: 'edited draft text' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rendered' }));

    const preview = screen.getByTestId('fragment-edit-dialog-rendered');
    expect(preview).toHaveTextContent('edited draft text');
    expect(preview).not.toHaveTextContent('original text');
  });

  it('defaults to Raw mode on open', () => {
    render(
      <FragmentEditDialog
        open
        title="Your Mission"
        initialText="Find companies."
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.getByRole('button', { name: 'Raw' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Rendered' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('renders nothing interactive when closed', () => {
    render(
      <FragmentEditDialog
        open={false}
        title="Your Mission"
        initialText="Find companies."
        onApply={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(screen.queryByRole('textbox', { name: 'Your Mission markdown' })).not.toBeInTheDocument();
  });
});
