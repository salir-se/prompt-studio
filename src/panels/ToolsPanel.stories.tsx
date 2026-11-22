import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { buildToolDirectory } from '../catalog/tool-directory';
import { ToolsPanel } from './ToolsPanel';

const meta = {
  decorators: [
    (Story) => (
      <div className="studio min-h-dvh bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
  title: 'Prompts/PromptStudio/RuntimeTools',
  component: ToolsPanel,
  args: { onClose: fn(), usedToolNames: [buildToolDirectory()[0].name] },
} satisfies Meta<typeof ToolsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllTools: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const drawer = canvas.getByTestId('tools-drawer').getBoundingClientRect();
    const card = canvas.getAllByTestId('tool-definition-node')[0].getBoundingClientRect();
    await expect(card.right).toBeLessThanOrEqual(drawer.right);
    await expect(card.left).toBeGreaterThanOrEqual(drawer.left);
  },
};
export const UsedByPrompt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Used by selected prompt' }));
    await expect(canvas.getAllByTestId('tool-definition-node')).toHaveLength(1);
  },
};
export const NoMatches: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('searchbox'), 'missing-runtime-tool');
    await expect(canvas.getByText('No tools match these filters.')).toBeVisible();
  },
};
