// @module-tag dom

import type { PromptDesign } from '@prompt-studio/prompts';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  authoredPromptRootsFromHeads,
  promptDesignProviderKey,
  serializePromptDesign,
} from '../design/prompt-design-project';
import { createWorkspacePrompt } from '../prompt-repo/workspace-document';
import { VerificationPanel } from './VerificationPanel';
import { runRootVerification } from './root-verification';
import { WHOLE_PROMPT } from './verification/verification-editing';

const source = '# Task\nSummarize {{document}} using only supplied evidence.\n\n# Output\nCite the source.';
const initial = createWorkspacePrompt({
  id: 'harness',
  title: 'Existing prompt',
  configuration: '',
  tool: '',
  variable: 'document',
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function Harness({
  save,
  openTests = () => {},
}: {
  save: (design: PromptDesign) => Promise<void>;
  openTests?: () => void;
}) {
  const [design, setDesign] = useState(initial.design);
  const root = authoredPromptRootsFromHeads(
    new Map([
      ['harness', source],
      [promptDesignProviderKey('harness'), serializePromptDesign(design)],
    ]),
  ).roots[0]!;
  return (
    <VerificationPanel
      root={root}
      text={source}
      result={runRootVerification(root, source)}
      onClose={() => {}}
      target={{ scope: WHOLE_PROMPT, tab: 'checks', request: 1 }}
      onSaveDesign={async (next) => {
        await save(next);
        setDesign(next);
      }}
      onRecheck={() => {}}
      onOpenTests={openTests}
    />
  );
}
it('adds an inferred variable check and rechecks without modifying existing instructions', async () => {
  const save = vi.fn(async (_design: PromptDesign) => {});
  render(<Harness save={save} />);
  fireEvent.click(screen.getByRole('button', { name: /^Keep \{\{document\}\}/ }));
  await waitFor(() => expect(save).toHaveBeenCalledOnce());
  const stored = save.mock.calls[0][0];
  expect(
    stored.verificationProfiles.find((profile) => profile.scope === 'consolidated')?.deterministicRules,
  ).toContainEqual(expect.objectContaining({ kind: 'required-placeholder', name: 'document' }));
  expect(screen.getByRole('textbox', { name: 'Verification prompt source' })).toHaveValue(source);
  expect(await screen.findByText('Checks saved and rechecked', { exact: true })).toBeVisible();
});
it('saves a custom check directly and keeps failed saves retryable', async () => {
  const save = vi.fn<(design: PromptDesign) => Promise<void>>(async (_design) => {
    throw new Error('Disk unavailable');
  });
  render(<Harness save={save} />);
  fireEvent.click(screen.getByRole('button', { name: 'Add automatic check' }));
  const field = screen.getByRole('textbox', { name: 'Required text' });
  expect(field).toHaveFocus();
  fireEvent.change(field, { target: { value: 'Cite the source.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add check' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Disk unavailable'));
  expect(save).toHaveBeenCalledOnce();
  expect(screen.getByText('Includes “Cite the source.”.')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Save checks and recheck' })).toBeEnabled();
  save.mockResolvedValue(undefined);
  fireEvent.click(screen.getByRole('button', { name: 'Save checks and recheck' }));
  await waitFor(() => expect(screen.getByText('Checks saved and rechecked', { exact: true })).toBeVisible());
  expect(screen.getByRole('textbox', { name: 'Verification prompt source' })).toHaveValue(source);
});
it('links the prompt harness to whole-prompt evaluation cases', async () => {
  const openTests = vi.fn();
  render(<Harness save={async () => {}} openTests={openTests} />);
  fireEvent.click(screen.getByRole('button', { name: 'Whole-prompt evaluation tests' }));
  expect(openTests).toHaveBeenCalledOnce();
  await act(async () => {});
});
