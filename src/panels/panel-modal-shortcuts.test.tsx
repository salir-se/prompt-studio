// @module-tag dom
import { createBlankPromptDesign } from '@prompt-studio/prompts';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { StudioPanelFocus } from '../components/StudioPanelFocus';
import { withPromptStructure } from '../design/prompt-design-project';
import { SUPPORT_TRIAGE_TEXT, supportTriageRoot } from '../test-fixtures/starter-catalog';
import { PromptDesignPanel } from './PromptDesignPanel';
import { runRootVerification, VerificationPanel } from './VerificationPanel';

it('saves Design from its workflow field while the responsive workspace is a modal', async () => {
  const created = createBlankPromptDesign({ id: 'modal', title: 'Modal' });
  const onSave = vi.fn().mockResolvedValue(undefined);
  render(
    <StudioPanelFocus modal>
      <PromptDesignPanel design={created.design} text={created.text} onSave={onSave} onClose={vi.fn()} />
    </StudioPanelFocus>,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Choose pattern' }));
  fireEvent.keyDown(screen.getByRole('button', { name: 'Use pattern' }), { key: 's', ctrlKey: true });
  expect(onSave).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Use pattern' }));
  const field = screen.getByLabelText('Major workflow Mermaid');
  fireEvent.change(field, { target: { value: 'flowchart LR\n  Request --> Result' } });
  fireEvent.keyDown(field, { key: 's', ctrlKey: true });
  await waitFor(() => expect(onSave).toHaveBeenCalledOnce());
  expect(onSave.mock.calls[0][0].workflow).toContain('Request --> Result');
});

it('opens the first finding in source while the responsive review workspace is a modal', () => {
  // Given: a verified prompt whose source lost its required placeholder, shown in the modal review workspace
  const broken = SUPPORT_TRIAGE_TEXT.replaceAll('{{customer_message}}', '');
  const root = withPromptStructure(supportTriageRoot(), broken);
  const result = runRootVerification(root, broken);
  expect(result?.findings.length).toBeGreaterThan(0);
  render(
    <StudioPanelFocus modal>
      <VerificationPanel root={root} result={result} onSaveText={vi.fn()} onClose={vi.fn()} />
    </StudioPanelFocus>,
  );
  // When: Ctrl+Enter is pressed; Then: the first finding opens in the source editor
  fireEvent.keyDown(screen.getByRole('button', { name: 'Close' }), { key: 'Enter', ctrlKey: true });
  expect(screen.getByRole('textbox', { name: 'Verification prompt source' })).toHaveFocus();
});
