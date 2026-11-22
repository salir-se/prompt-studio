import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { NewPromptDialog } from './NewPromptDialog';

const meta = {
  component: NewPromptDialog,
  title: 'Prompts/PromptStudio/NewPromptDialog',
  args: { open: true, existingIds: ['scout'], onCreate: fn(), onCancel: fn() },
} satisfies Meta<typeof NewPromptDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const ReadyToCreate: Story = {
  play: async () => {
    const canvas = within(document.body);
    await userEvent.type(canvas.getByLabelText('Prompt ID'), 'account-research');
    await userEvent.type(canvas.getByLabelText('Prompt title'), 'Account Research');
  },
};

export const DuplicateId: Story = {
  play: async () => {
    const canvas = within(document.body);
    await userEvent.type(canvas.getByLabelText('Prompt ID'), 'scout');
    await userEvent.type(canvas.getByLabelText('Prompt title'), 'Duplicate Scout');
  },
};

export const Mobile: Story = { parameters: { viewport: { defaultViewport: 'iphoneSE' } } };

export const WithDependencies: Story = {
  play: async () => {
    const canvas = within(document.body);
    await userEvent.type(canvas.getByLabelText('Prompt ID'), 'document-summary');
    await userEvent.type(canvas.getByLabelText('Prompt title'), 'Evidence-based document summary');
    await userEvent.click(canvas.getByText('Inputs and tools'));
    await userEvent.type(canvas.getByLabelText('Tool', { exact: true }), 'fetch_document');
    await userEvent.type(canvas.getByLabelText('Tool description'), 'Retrieve a document by its source identifier.');
    await userEvent.type(canvas.getByLabelText('Variable', { exact: true }), 'source_document');
    await userEvent.type(
      canvas.getByLabelText('Variable purpose'),
      'Document whose claims must be summarized and cited.',
    );
    await userEvent.type(canvas.getByLabelText('Example value'), 'Revenue increased 12% in 2025.');
  },
};
export const InvalidToolSchema: Story = {
  play: async () => {
    const canvas = within(document.body);
    await WithDependencies.play?.({} as never);
    await userEvent.clear(canvas.getByLabelText('Input JSON Schema'));
    await userEvent.type(canvas.getByLabelText('Input JSON Schema'), 'not valid JSON');
    await userEvent.click(canvas.getByRole('button', { name: 'Create prompt' }));
  },
};

export const SaveFailure: Story = {
  args: {
    onCreate: fn(async () => {
      throw new Error(
        'The saved project changed. Your prompt details are kept. Reopen the original project before retrying.',
      );
    }),
  },
  play: async () => {
    const body = within(document.body);
    await userEvent.type(body.getByLabelText('Prompt ID'), 'find-correct-email');
    await userEvent.type(body.getByLabelText('Prompt title'), 'Find correct email');
    await userEvent.click(body.getByRole('button', { name: 'Create prompt' }));
    await expect(await body.findByRole('alert')).toHaveFocus();
    await expect(body.getByLabelText('Prompt ID')).toHaveValue('find-correct-email');
    await expect(body.getByRole('button', { name: 'Create prompt' })).toBeEnabled();
    const fields = body.getByLabelText('Prompt ID').closest('fieldset')!;
    let scrollArea: HTMLElement = fields;
    while (getComputedStyle(scrollArea).overflowY !== 'auto' && scrollArea.parentElement)
      scrollArea = scrollArea.parentElement;
    const alert = body.getByRole('alert').getBoundingClientRect();
    const footer = body.getByRole('button', { name: 'Create prompt' }).parentElement!.getBoundingClientRect();
    await expect(scrollArea.getBoundingClientRect().bottom).toBeLessThanOrEqual(alert.top);
    await expect(alert.bottom).toBeLessThanOrEqual(footer.top);
    const paintedFields = document
      .elementsFromPoint(alert.left + alert.width / 2, alert.top + alert.height / 2)
      .filter((element) => fields.contains(element));
    await expect(paintedFields).toHaveLength(0);
  },
};

export const Creating: Story = {
  args: { onCreate: fn(() => new Promise<void>(() => {})) },
  play: async () => {
    const body = within(document.body);
    await userEvent.type(body.getByLabelText('Prompt ID'), 'find-correct-email');
    await userEvent.type(body.getByLabelText('Prompt title'), 'Find correct email');
    await userEvent.click(body.getByRole('button', { name: 'Create prompt' }));
    await expect(body.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    await expect(body.getByRole('button', { name: 'Cancel' })).toBeDisabled();
  },
};

export const SuggestedId: Story = {
  play: async () => {
    const body = within(document.body);
    await userEvent.type(body.getByLabelText('Prompt title'), 'Evidence summary');
    await expect(body.getByLabelText('Prompt ID')).toHaveValue('evidence-summary');
    await expect(body.getByRole('button', { name: 'Create prompt' })).toBeEnabled();
  },
};
