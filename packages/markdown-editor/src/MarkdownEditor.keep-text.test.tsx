// @module-tag dom
/**
 * Keep the author's text (release flag `app.markdown-editor.keep-author-text`, passed in through
 * `MarkdownEditorPolicyProvider`): a field whose text the Visual view would change opens in Raw and says why, the
 * author can still choose Visual on purpose, and with the policy off the editor behaves as before.
 *
 * The real Crepe editor needs a browser; here it is mocked at the module boundary and reports what the real one
 * measures (see `MilkdownCrepeEditor.tsx` and the `round-trip.corpus` outcome test for the measurement itself).
 */
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Fidelity, RequiredFidelity } from './markdown-fidelity';

interface KeepText {
  required: RequiredFidelity;
  onWouldChange: (measured: Fidelity) => void;
}

const { mockCrepe } = vi.hoisted(() => ({
  mockCrepe: vi.fn(({ defaultValue, keepText }: { defaultValue: string; keepText?: KeepText }) => (
    <div data-testid="crepe-editor" data-default-value={defaultValue} data-required={keepText?.required ?? 'none'}>
      <button type="button" onClick={() => keepText?.onWouldChange('changed')}>
        report-changed
      </button>
      <button type="button" onClick={() => keepText?.onWouldChange('equivalent')}>
        report-reformatted
      </button>
    </div>
  )),
}));

vi.mock('./MilkdownCrepeEditor', () => ({ default: mockCrepe }));

import { MarkdownEditor, MarkdownEditorPolicyProvider } from './index';

function renderEditor(options: { keepAuthorText: boolean; requiredFidelity?: RequiredFidelity }) {
  return render(
    <MarkdownEditorPolicyProvider value={{ keepAuthorText: options.keepAuthorText, visualProse: false }}>
      <MarkdownEditor value="- a" onChange={() => {}} ariaLabel="Summary" requiredFidelity={options.requiredFidelity} />
    </MarkdownEditorPolicyProvider>,
  );
}

describe('keep the author text', () => {
  it('opens a text the Visual view would change in Raw and says why', async () => {
    // Given: the policy is on and the editor measures that Visual would change the meaning.
    const user = userEvent.setup({ delay: null });
    renderEditor({ keepAuthorText: true });
    // When: the Visual editor reports it.
    await user.click(await screen.findByRole('button', { name: 'report-changed' }));
    // Then: the field shows the exact text in Raw.
    expect(screen.getByRole('textbox', { name: 'Summary' })).toHaveValue('- a');
    expect(screen.getByRole('button', { name: 'Raw' })).toHaveAttribute('aria-pressed', 'true');
    // And: a status message says what Visual would do and that Visual is still available.
    expect(screen.getByRole('status')).toHaveTextContent(
      'The Visual view would change what this text says, so it opened in Raw. Choose Visual to edit it there anyway.',
    );
  });

  it('names reformatting separately from a change of meaning', async () => {
    // Given: a field that requires exact bytes and an editor that would only reformat it.
    const user = userEvent.setup({ delay: null });
    renderEditor({ keepAuthorText: true, requiredFidelity: 'exact' });
    // When: the Visual editor reports reformatting.
    await user.click(await screen.findByRole('button', { name: 'report-reformatted' }));
    // Then: the message says the text would be reformatted, not that its meaning changes.
    expect(screen.getByRole('status')).toHaveTextContent(
      'The Visual view would reformat this text (spacing or list markers), so it opened in Raw.',
    );
  });

  it('lets the author choose Visual on purpose, without measuring again', async () => {
    // Given: the field fell back to Raw.
    const user = userEvent.setup({ delay: null });
    renderEditor({ keepAuthorText: true });
    await user.click(await screen.findByRole('button', { name: 'report-changed' }));
    // When: the author chooses Visual.
    await user.click(screen.getByRole('button', { name: 'Visual' }));
    // Then: the Visual editor opens without a fidelity requirement, so it does not bounce back to Raw.
    expect(await screen.findByTestId('crepe-editor')).toHaveAttribute('data-required', 'none');
    // And: the message is gone.
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('asks the Visual editor to keep the meaning by default, or the bytes when the field requires it', async () => {
    // Given / When: the policy is on, with the default requirement and with an exact requirement.
    const { unmount } = renderEditor({ keepAuthorText: true });
    // Then: the default requirement keeps the meaning.
    expect(await screen.findByTestId('crepe-editor')).toHaveAttribute('data-required', 'equivalent');
    unmount();
    renderEditor({ keepAuthorText: true, requiredFidelity: 'exact' });
    // And: an exact field keeps the bytes.
    expect(await screen.findByTestId('crepe-editor')).toHaveAttribute('data-required', 'exact');
  });

  it('behaves as before with the policy off', async () => {
    // Given: the policy is off (the release flag's default).
    renderEditor({ keepAuthorText: false, requiredFidelity: 'exact' });
    // When / Then: the Visual editor opens with no fidelity requirement and no message.
    expect(await screen.findByTestId('crepe-editor')).toHaveAttribute('data-required', 'none');
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('prose fields', () => {
  function renderProse(visualProse: boolean) {
    return render(
      <MarkdownEditorPolicyProvider value={{ keepAuthorText: true, visualProse }}>
        <MarkdownEditor mode="prose" value="Called Anna" onChange={() => {}} ariaLabel="Note" />
      </MarkdownEditorPolicyProvider>,
    );
  }

  it('opens a prose field in the Visual editor, keeping the author text, while Visual prose is on', async () => {
    // Given: the Visual prose policy is on.
    renderProse(true);
    // When / Then: the field is the Visual editor with the default meaning requirement and a Visual / Raw switch.
    expect(await screen.findByTestId('crepe-editor')).toHaveAttribute('data-required', 'equivalent');
    expect(screen.getByRole('button', { name: 'Visual' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('keeps a prose field the plain text box it was while Visual prose is off', () => {
    // Given: the Visual prose policy is off (the release flag's default).
    renderProse(false);
    // When / Then: the field is a plain text box with the exact text and no Visual / Raw switch.
    expect(screen.getByRole('textbox', { name: 'Note' })).toHaveValue('Called Anna');
    expect(screen.queryByRole('button', { name: 'Visual' })).toBeNull();
    expect(screen.queryByTestId('crepe-editor')).toBeNull();
  });
});
