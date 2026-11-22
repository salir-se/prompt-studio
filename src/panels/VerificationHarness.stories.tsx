import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import {
  authoredPromptRootsFromHeads,
  promptDesignProviderKey,
  serializePromptDesign,
} from '../design/prompt-design-project';
import { createWorkspacePrompt } from '../prompt-repo/workspace-document';
import { VerificationPanel } from './VerificationPanel';
import { runRootVerification } from './root-verification';
import { WHOLE_PROMPT } from './verification/verification-editing';

const source =
  '# Task\nSummarize {{document}} using only supplied evidence.\n\n# Output\nCite the source and state when evidence is missing.';
const initial = createWorkspacePrompt({
  id: 'harness',
  title: 'Existing research prompt',
  configuration: '',
  tool: '',
  variable: 'document',
});
const LONG_VARIABLE =
  'source_document_customer_research_evidence_and_project_specific_qualifications_for_the_final_answer';
const LONG_TOOL = 'lookup_customer_research_evidence_with_project_specific_qualifications';
const longSource = source
  .replace('{{document}}', `{{${LONG_VARIABLE}}}`)
  .replace('using only', `using ${LONG_TOOL} and only`);
const longInitial = createWorkspacePrompt({
  id: 'harness',
  title: 'Existing research prompt',
  configuration: '',
  tool: LONG_TOOL,
  variable: LONG_VARIABLE,
});
function HarnessStory({ failed = false, longNames = false }: { failed?: boolean; longNames?: boolean }) {
  const text = longNames ? longSource : source;
  const [design, setDesign] = useState(longNames ? longInitial.design : initial.design);
  const root = authoredPromptRootsFromHeads(
    new Map([
      ['harness', text],
      [promptDesignProviderKey('harness'), serializePromptDesign(design)],
    ]),
  ).roots[0]!;
  return (
    <div className="studio h-dvh bg-background text-foreground">
      <div data-studio-panels>
        <VerificationPanel
          root={root}
          text={text}
          result={runRootVerification(root, text)}
          onClose={() => {}}
          target={{ scope: WHOLE_PROMPT, tab: 'checks', request: 1 }}
          onSaveDesign={async (next) => {
            if (failed) throw new Error('Project storage is unavailable. Retry saving your check.');
            setDesign(next);
          }}
          onRecheck={() => {}}
          onOpenTests={() => {}}
        />
      </div>
    </div>
  );
}
const meta = {
  title: 'Prompts/PromptStudio/VerificationHarness',
  parameters: { layout: 'fullscreen' },
  render: () => <HarnessStory />,
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ExistingPrompt: Story = {};
export const VariablePreset: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /^Keep \{\{document\}\}/ }));
    await expect(canvas.getByText('Checks saved and rechecked', { exact: true })).toBeVisible();
    await expect(canvas.getByRole('textbox', { name: 'Verification prompt source' })).toHaveValue(source);
  },
};
export const FailedSave: Story = {
  render: () => <HarnessStory failed />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /^Keep \{\{document\}\}/ }));
    await expect(canvas.getByRole('alert')).toHaveTextContent('Project storage is unavailable.');
    await expect(canvas.getByRole('button', { name: 'Save checks and recheck' })).toBeEnabled();
  },
};
export const CustomCheck: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Add automatic check' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'Required text' }), 'Cite the source');
  },
};

/** #2531: long project identifiers remain fully readable at desktop and phone widths. */
export const LongIdentifiers: Story = {
  render: () => <HarnessStory longNames />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const harness = canvas.getByRole('region', { name: 'Build a verification harness' });
    const bounds = harness.getBoundingClientRect();
    const viewportWidth = canvasElement.ownerDocument.documentElement.clientWidth;
    await expect(bounds.left).toBeGreaterThanOrEqual(0);
    await expect(bounds.right).toBeLessThanOrEqual(viewportWidth);
    for (const button of within(harness).getAllByRole('button')) {
      const rect = button.getBoundingClientRect();
      await expect(rect.left).toBeGreaterThanOrEqual(bounds.left);
      await expect(rect.right).toBeLessThanOrEqual(bounds.right);
      await expect(button.scrollWidth).toBeLessThanOrEqual(button.clientWidth + 1);
    }
  },
};

/** #2531: saving long-named preset requirements keeps complete identities and the original source. */
export const LongIdentifiersSaved: Story = {
  render: () => <HarnessStory longNames />,
  play: async (context) => {
    await LongIdentifiers.play?.(context);
    const canvas = within(context.canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: new RegExp(`^Keep \\{\\{${LONG_VARIABLE}`) }));
    await expect(canvas.getByText('Checks saved and rechecked', { exact: true })).toBeVisible();
    await userEvent.click(canvas.getByText(/^Suggested checks/));
    await userEvent.click(canvas.getByRole('button', { name: new RegExp(`^Keep tool ${LONG_TOOL}`) }));
    await expect(canvas.queryByRole('button', { name: new RegExp(`^Keep tool ${LONG_TOOL}`) })).not.toBeInTheDocument();
    await expect(canvas.getByRole('list', { name: 'Section rules' })).toHaveTextContent(LONG_VARIABLE);
    await expect(canvas.getByRole('list', { name: 'Section rules' })).toHaveTextContent(LONG_TOOL);
    await expect(canvas.getByRole('textbox', { name: 'Verification prompt source' })).toHaveValue(longSource);
  },
};

/** #2533: an open check draft keeps competing edit/remove actions disabled until Update or Cancel. */
export const CheckEditDraft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    for (const literal of ['Alpha baseline.', 'Beta baseline.']) {
      await userEvent.click(canvas.getByRole('button', { name: 'Add automatic check' }));
      await userEvent.type(canvas.getByRole('textbox', { name: 'Required text' }), literal);
      await userEvent.click(canvas.getByRole('button', { name: 'Add check' }));
      await canvas.findByText(`Includes “${literal}”.`);
    }
    const alpha = within(canvas.getByText('Includes “Alpha baseline.”.').closest('li')!);
    await userEvent.click(alpha.getByRole('button', { name: 'Edit Required text' }));
    await userEvent.clear(canvas.getByRole('textbox', { name: 'Required text' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'Required text' }), 'Alpha revised.');
    const beta = within(canvas.getByText('Includes “Beta baseline.”.').closest('li')!);
    await expect(beta.getByRole('button', { name: 'Edit Required text' })).toBeDisabled();
    await expect(canvas.getByRole('button', { name: 'Remove Contains instructions' })).toBeDisabled();
    await expect(canvas.getByRole('textbox', { name: 'Required text' })).toHaveValue('Alpha revised.');
    await expect(canvas.getByRole('textbox', { name: 'Verification prompt source' })).toHaveValue(source);
  },
};

/** #2533: updating Alpha preserves Beta; cancelling another draft releases actions for a later removal. */
export const CheckEditSaved: Story = {
  play: async (context) => {
    await CheckEditDraft.play?.(context);
    const canvas = within(context.canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Update check' }));
    await canvas.findByText('Includes “Alpha revised.”.');
    await expect(canvas.getByText('Includes “Beta baseline.”.')).toBeVisible();
    const alpha = within(canvas.getByText('Includes “Alpha revised.”.').closest('li')!);
    await userEvent.click(alpha.getByRole('button', { name: 'Edit Required text' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'Required text' }), ' Discard this draft.');
    await userEvent.click(canvas.getByRole('button', { name: 'Cancel check' }));
    await expect(canvas.getByRole('button', { name: 'Remove Contains instructions' })).toBeEnabled();
    await userEvent.click(canvas.getByRole('button', { name: 'Remove Contains instructions' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Save checks and recheck' }));
    await expect(canvas.getByText('Checks saved and rechecked', { exact: true })).toBeVisible();
    await expect(canvas.getByText('Includes “Alpha revised.”.')).toBeVisible();
    await expect(canvas.getByText('Includes “Beta baseline.”.')).toBeVisible();
    await expect(canvas.getByRole('textbox', { name: 'Verification prompt source' })).toHaveValue(source);
  },
};
