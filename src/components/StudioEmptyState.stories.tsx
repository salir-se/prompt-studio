import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { StudioEmptyState } from './StudioEmptyState';

const meta = {
  title: 'Prompts/PromptStudio/Start',
  component: StudioEmptyState,
  args: { canCreate: true, onCreate: fn(), onOpenProject: fn() },
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="studio flex min-h-[650px] bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof StudioEmptyState>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Ready: Story = {};
export const ProjectUnavailable: Story = { args: { canCreate: false } };
