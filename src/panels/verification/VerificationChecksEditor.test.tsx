// @module-tag dom
import { createBlankPromptDesign, type PromptDesign } from '@prompt-studio/prompts';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import {
  authoredPromptRootsFromHeads,
  promptDesignProviderKey,
  serializePromptDesign,
} from '../../design/prompt-design-project';
import { createWorkspacePrompt } from '../../prompt-repo/workspace-document';
import { VerificationPanel } from '../VerificationPanel';
import { runRootVerification } from '../root-verification';
import { VerificationChecksEditor } from './VerificationChecksEditor';
import { WHOLE_PROMPT } from './verification-editing';

it('requires an authored AI criterion and keeps a partial-save failure retryable', async () => {
  // Given: a native prompt and an editor whose history accepts changes before its disk writer fails.
  let current = createBlankPromptDesign({ id: 'checks', title: 'Checks' }).design;
  const dirty = vi.fn();
  const onSave = vi.fn(async (revised: PromptDesign) => {
    current = revised;
    view.rerender(props());
    throw new Error('Disk unavailable');
  });
  const props = () => (
    <VerificationChecksEditor
      profiles={current.verificationProfiles}
      design={current}
      scope={WHOLE_PROMPT}
      disabled={false}
      onSave={onSave}
      onDirtyChange={dirty}
    />
  );
  const view = render(props());
  fireEvent.click(screen.getByRole('button', { name: 'Add AI criterion' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save checks and recheck' }));
  expect(screen.getByRole('alert')).toHaveTextContent('Describe each AI criterion');
  expect(onSave).not.toHaveBeenCalled();
  // When: the author supplies the criterion and durable saving fails.
  fireEvent.change(screen.getByRole('textbox', { name: 'AI criterion 1' }), {
    target: { value: 'Every claim cites evidence.' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Save checks and recheck' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Disk unavailable'));
  // Then: the accepted local version does not masquerade as an external conflict or disable retry.
  expect(screen.getByRole('textbox', { name: 'AI criterion 1' })).toHaveValue('Every claim cites evidence.');
  expect(screen.getByRole('button', { name: 'Save checks and recheck' })).toBeEnabled();
  expect(screen.queryByText(/saved design changed/)).not.toBeInTheDocument();
});

it('immediately removes authored checks and criteria while retaining generated requirements', () => {
  const blank = createBlankPromptDesign({ id: 'remove', title: 'Remove' }).design;
  const design = {
    ...blank,
    verificationProfiles: blank.verificationProfiles.map((profile) => ({
      ...profile,
      deterministicRules: [
        {
          id: 'authored',
          kind: 'minimum-length' as const,
          minChars: 40,
          severity: 'error' as const,
          enforcement: 'edit' as const,
        },
      ],
      principles: [
        {
          id: 'authored-ai',
          version: 1,
          owner: 'configuration' as const,
          statement: 'Cite evidence.',
          severity: 'warning' as const,
          allowedCustomization: 'Editable',
          sectionIds: [],
        },
      ],
    })),
  };
  const profiles = design.verificationProfiles.map((profile) => ({
    ...profile,
    deterministicRules: [
      ...profile.deterministicRules,
      {
        id: 'derived',
        kind: 'minimum-length' as const,
        minChars: 10,
        severity: 'warning' as const,
        enforcement: 'edit' as const,
      },
    ],
  }));
  render(
    <VerificationChecksEditor
      profiles={profiles}
      design={design}
      scope={WHOLE_PROMPT}
      disabled={false}
      onSave={vi.fn()}
      onDirtyChange={vi.fn()}
    />,
  );
  fireEvent.click(screen.getByRole('button', { name: 'Remove Minimum length' }));
  fireEvent.click(screen.getByRole('button', { name: 'Remove AI criterion 1' }));
  expect(screen.queryByText('At least 40 characters.')).not.toBeInTheDocument();
  expect(screen.queryByText('Cite evidence.')).not.toBeInTheDocument();
  expect(screen.getByText('Provided by Studio')).toBeInTheDocument();
});

it('#2533: saves the intended check and preserves its sibling identities through Cancel and later removal', async () => {
  const source = '# Task\nAlpha baseline. Beta baseline. Keep the prompt unchanged.';
  const initial = createWorkspacePrompt({ id: 'checks', title: 'Checks', configuration: '', tool: '', variable: '' });
  const edit = { severity: 'error', enforcement: 'edit' } as const;
  const initialDesign: PromptDesign = {
    ...initial.design,
    verificationProfiles: initial.design.verificationProfiles.map((profile) =>
      profile.scope !== 'consolidated'
        ? profile
        : {
            ...profile,
            deterministicRules: [
              { id: 'earlier', kind: 'non-empty', ...edit },
              { id: 'alpha', kind: 'required-output-literal', literal: 'Alpha baseline.', ...edit },
              { id: 'beta', kind: 'required-output-literal', literal: 'Beta baseline.', ...edit },
            ],
          },
    ),
  };
  const saved = vi.fn(async (_next: PromptDesign) => {});
  function Harness() {
    const [design, setDesign] = useState(initialDesign);
    const root = authoredPromptRootsFromHeads(
      new Map([
        ['checks', source],
        [promptDesignProviderKey('checks'), serializePromptDesign(design)],
      ]),
    ).roots[0]!;
    return (
      <VerificationPanel
        root={root}
        text={source}
        result={runRootVerification(root, source)}
        target={{ scope: WHOLE_PROMPT, tab: 'checks', request: 1 }}
        onClose={() => {}}
        onRecheck={() => {}}
        onSaveDesign={async (next) => {
          await saved(next);
          setDesign(next);
        }}
      />
    );
  }
  render(<Harness />);
  function row(literal: string) {
    return within(screen.getByText(`Includes “${literal}”.`).closest('li')!);
  }
  function storedRules() {
    return saved.mock.calls.at(-1)![0].verificationProfiles.find((profile) => profile.scope === 'consolidated')!
      .deterministicRules;
  }
  fireEvent.click(row('Alpha baseline.').getByRole('button', { name: 'Edit Required text' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Required text' }), { target: { value: 'Alpha revised.' } });
  // This competing mutation previously shifted Alpha's saved index onto Beta before Update.
  fireEvent.click(screen.getByRole('button', { name: 'Remove Contains instructions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Update check' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(1));
  expect(storedRules()).toEqual([
    { id: 'earlier', kind: 'non-empty', ...edit },
    { id: 'alpha', kind: 'required-output-literal', literal: 'Alpha revised.', ...edit },
    { id: 'beta', kind: 'required-output-literal', literal: 'Beta baseline.', ...edit },
  ]);
  expect(screen.getByRole('textbox', { name: 'Verification prompt source' })).toHaveValue(source);
  await screen.findByText('Checks saved and rechecked', { exact: true });

  fireEvent.click(row('Alpha revised.').getByRole('button', { name: 'Edit Required text' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Required text' }), { target: { value: 'Abandoned draft.' } });
  const editBeta = row('Beta baseline.').getByRole('button', { name: 'Edit Required text' });
  expect(editBeta).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Remove Contains instructions' })).toBeDisabled();
  fireEvent.click(editBeta);
  expect(screen.getByRole('textbox', { name: 'Required text' })).toHaveValue('Abandoned draft.');
  fireEvent.click(screen.getByRole('button', { name: 'Cancel check' }));
  expect(row('Beta baseline.').getByRole('button', { name: 'Edit Required text' })).toBeEnabled();
  expect(screen.getByRole('button', { name: 'Remove Contains instructions' })).toBeEnabled();
  expect(saved).toHaveBeenCalledTimes(1);

  fireEvent.click(screen.getByRole('button', { name: 'Remove Contains instructions' }));
  fireEvent.click(screen.getByRole('button', { name: 'Save checks and recheck' }));
  await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
  expect(storedRules()).toEqual([
    { id: 'alpha', kind: 'required-output-literal', literal: 'Alpha revised.', ...edit },
    { id: 'beta', kind: 'required-output-literal', literal: 'Beta baseline.', ...edit },
  ]);
  expect(screen.getByRole('textbox', { name: 'Verification prompt source' })).toHaveValue(source);
});
