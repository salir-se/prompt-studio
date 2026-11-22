import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { FragmentNode } from './FragmentNode';
import { LAYOUT_COLLAPSED_CARD_HEIGHT } from './layout';

const meta = {
  component: FragmentNode,
  title: 'Prompts/PromptGraphUi/VerificationCoverage',
  decorators: [
    (Story) => (
      <div className="w-[360px] max-w-full bg-background p-4">
        <Story />
      </div>
    ),
  ],
  args: {
    title: 'Mission',
    delimiter: 'xml-tag',
    depth: 1,
    text: 'Produce an evidence-based summary of the supplied source.',
    variables: [],
    toolMentions: [],
    onOpenVerification: fn(),
    coverage: {
      sectionId: 'example.mission',
      automatic: { basic: 1, custom: 0, status: 'not-checked' },
      ai: { generated: 3, custom: 0, status: 'not-checked' },
    },
  },
} satisfies Meta<typeof FragmentNode>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ConfiguredBeforeChecking: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const automatic = canvas.getByRole('button', { name: /Automatic checks for Mission/ });
    automatic.focus();
    await userEvent.keyboard('{Enter}');
    await expect(args.onOpenVerification).toHaveBeenCalledWith('example.mission', 'checks');
    await userEvent.tab();
    await expect(canvas.getByRole('button', { name: /AI criteria for Mission/ })).toHaveFocus();
    await userEvent.keyboard(' ');
    await expect(args.onOpenVerification).toHaveBeenCalledWith('example.mission', 'ai');
  },
};
export const CurrentAutomaticStaleAi: Story = {
  args: {
    coverage: {
      sectionId: 'example.mission',
      automatic: { basic: 1, custom: 2, status: 'current' },
      ai: { generated: 3, custom: 1, status: 'stale' },
    },
  },
};
export const NoSectionChecks: Story = {
  args: {
    coverage: {
      sectionId: 'example.mission',
      automatic: { basic: 0, custom: 0, status: 'not-checked' },
      ai: { generated: 0, custom: 0, status: 'not-checked' },
    },
  },
};
export const CollapsedAllControls: Story = {
  render: (args) => (
    <div style={{ height: LAYOUT_COLLAPSED_CARD_HEIGHT }}>
      <FragmentNode {...args} />
    </div>
  ),
  args: {
    title: 'Very long section title containing the source review instructions',
    collapsed: true,
    fillContainer: true,
    selected: true,
    promptAnchor: 'both',
    verification: { state: 'invalid', findingCount: 3 },
    onEditRequest: fn(),
    onToggleCollapse: fn(),
    sectionActions: {
      onAddChildSection: fn(),
      onAddSiblingSection: fn(),
      onRemoveSection: fn(),
      onMoveUp: fn(),
      onMoveDown: fn(),
    },
  },
};
