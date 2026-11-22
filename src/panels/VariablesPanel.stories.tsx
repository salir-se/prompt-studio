import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { VariablesPanel } from './VariablesPanel';

const meta = {
  decorators: [
    (Story) => (
      <div className="studio min-h-dvh bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
  title: 'Prompts/PromptStudio/RuntimeVariables',
  component: VariablesPanel,
  args: { onClose: fn(), usedVariableNames: ['product_name'] },
} satisfies Meta<typeof VariablesPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const AllVariables: Story = {};
export const UsedByPrompt: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('checkbox', { name: 'Used by selected prompt' }));
    await expect(canvas.getAllByTestId('variable-directory-row')).toHaveLength(1);
  },
};
export const UndeclaredInput: Story = { args: { undeclaredNames: ['customer_request'] } };
export const FailedDeclaration: Story = {
  args: { onDeclare: () => ({ error: 'Purpose is required — describe why the prompt needs this variable.' }) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Variable name' }), 'customer_request');
    await userEvent.click(canvas.getByRole('button', { name: 'Declare variable' }));
    await expect(canvas.getByRole('alert')).toBeVisible();
  },
};
