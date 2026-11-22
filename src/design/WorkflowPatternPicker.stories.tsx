import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import '../index.css';
import { WorkflowPatternPicker } from './WorkflowPatternPicker';

const meta = {
  title: 'Prompts/PromptStudio/WorkflowPatterns',
  component: WorkflowPatternPicker,
  args: { onUse: fn() },
} satisfies Meta<typeof WorkflowPatternPicker>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Preview: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole('button', { name: 'Choose pattern' }));
    await userEvent.click(body.getByRole('tab', { name: 'Parallel work (diamond)' }));
  },
};
export const AdaptivePlanning: Story = {
  play: async ({ canvasElement }) => {
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(body.getByRole('button', { name: 'Choose pattern' }));
    await userEvent.click(body.getByRole('tab', { name: 'Adaptive planning' }));
  },
};

export const ReplacingWorkflow: Story = {
  args: { currentWorkflow: 'flowchart LR\n  Source --> Evidence --> CustomReview --> Summary' },
  play: Preview.play,
};
