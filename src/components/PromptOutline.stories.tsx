import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { PromptOutline } from './PromptOutline';
import { STORY_TREE } from './studio-story-fixtures';

const meta = {
  component: PromptOutline,
  title: 'Prompts/PromptStudio/Outline',
  args: {
    sections: STORY_TREE.children,
    onSelect: fn(),
    onEdit: fn(),
    onDesign: fn(),
    onAddAfter: fn(),
    onAddChild: fn(),
    onMove: fn(),
    onRemove: fn(),
  },
  decorators: [
    (Story) => (
      <div className="studio w-full max-w-80 bg-card p-3 text-foreground">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof PromptOutline>;
export default meta;
type Story = StoryObj<typeof meta>;
export const NestedSections: Story = {};
export const Empty: Story = { args: { sections: [] } };
export const Actions: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Section actions' }));
  },
};
export const AddSubsection: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Section actions' }));
    await userEvent.click(within(document.body).getByRole('menuitem', { name: 'Add sub-section' }));
  },
};
export const Mobile: Story = { parameters: { viewport: { defaultViewport: 'iphoneSE' } } };

export const CollapsedSelection: Story = {
  args: { selectedNodeId: `section:${STORY_TREE.children[0].children[0].id}` },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: /Collapse/i }));
    await userEvent.click(canvas.getByRole('button', { name: 'Section actions' }));
  },
};

export const KeyboardFocusedSection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('treeitem', { name: 'mission' }));
    await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(canvas.getByRole('treeitem', { name: 'evidence' })).toHaveFocus());
  },
};
