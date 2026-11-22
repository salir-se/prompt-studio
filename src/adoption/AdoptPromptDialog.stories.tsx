import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { emptyProjectDefinitions } from '../prompt-repo/project-definitions';
import { AdoptPromptDialog } from './AdoptPromptDialog';

const source =
  '---\nname: evidence-summary\ndescription: Summarize supplied evidence\n---\n# Evidence summary\n## Instructions\nRead {{document}} and @references/policy.md.\n## Output\nReturn an evidence-based summary.\nUse path\\to\\windows\\file.txt for context.';
const meta = {
  title: 'Prompts/PromptStudio/Adoption',
  component: AdoptPromptDialog,
  args: {
    definitions: emptyProjectDefinitions('Research'),
    existingIds: [],
    onAdopt: fn(async () => undefined),
    onClose: fn(),
  },
} satisfies Meta<typeof AdoptPromptDialog>;
export default meta;
type Story = StoryObj<typeof AdoptPromptDialog>;
export const Empty: Story = {};
export const Review: Story = { args: { initial: { text: source, filename: 'SKILL.md' } } };
export const SaveFailure: Story = {
  args: {
    initial: { text: source, filename: 'SKILL.md' },
    onAdopt: async () => {
      throw new Error('The disk is unavailable. Your draft is preserved. Retry saving.');
    },
  },
};

async function submitStory(canvasElement: HTMLElement) {
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.type(body.getByRole('textbox', { name: 'Adoption input' }), 'A document');
  await userEvent.type(body.getByRole('textbox', { name: 'Adoption output' }), 'A summary');
  await userEvent.type(body.getByRole('textbox', { name: 'Purpose of document' }), 'Source material');
  await userEvent.click(body.getByRole('button', { name: 'Save and verify' }));
  return body;
}
SaveFailure.play = async ({ canvasElement }) => {
  const body = await submitStory(canvasElement);
  await expect(await body.findByRole('alert')).toHaveTextContent('The disk is unavailable');
  await expect(body.getByRole('textbox', { name: 'Existing prompt' })).toHaveValue(source);
};
export const Saving: Story = {
  args: { initial: { text: source, filename: 'SKILL.md' }, onAdopt: () => new Promise<void>(() => undefined) },
  play: async ({ canvasElement }) => {
    const body = await submitStory(canvasElement);
    await expect(await body.findByRole('button', { name: 'Saving…' })).toBeDisabled();
  },
};
