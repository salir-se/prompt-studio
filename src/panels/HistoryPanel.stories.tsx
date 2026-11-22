import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { HistoryPanel } from './HistoryPanel';

const meta = {
  decorators: [
    (Story) => (
      <div className="studio min-h-dvh bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
  title: 'Prompts/PromptStudio/PromptHistory',
  component: HistoryPanel,
  args: {
    rootTitle: 'Customer Brief',
    busy: false,
    onClose: fn(),
    onRestore: fn(),
    onResetToShipped: fn(),
    commits: [
      {
        id: 'current12345',
        message: 'Clarify evidence and confidence requirements',
        timestampMs: 1792884600000,
        rootKey: 'customer-brief',
      },
      {
        id: 'previous12345',
        message: 'Add customer context and response format',
        timestampMs: 1792801800000,
        rootKey: 'customer-brief',
      },
      { id: 'baseline12345', message: 'Starting prompt', timestampMs: 1792715400000, rootKey: 'customer-brief' },
    ],
  },
} satisfies Meta<typeof HistoryPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Revisions: Story = {};
export const Loading: Story = { args: { commits: [], busy: true } };
export const Empty: Story = { args: { commits: [] } };

export const LoadFailure: Story = {
  args: { commits: [], error: 'Could not load history: local storage is unavailable.', onRetry: fn() },
};
export const RestoreFailure: Story = {
  args: { error: 'Could not restore revision. Your current prompt and history are unchanged.', onRetry: fn() },
};
