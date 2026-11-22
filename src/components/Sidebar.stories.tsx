import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { PromptOutline } from './PromptOutline';
import { Sidebar } from './Sidebar';
import { STORY_ROOT, STORY_TREE } from './studio-story-fixtures';

const meta = {
  component: Sidebar,
  title: 'Prompts/PromptStudio/Explorer',
  args: {
    catalog: [
      STORY_ROOT,
      { ...STORY_ROOT, id: 'support', title: 'Support reply' },
      { ...STORY_ROOT, id: 'release-notes', title: 'Release notes for a long-running project with many contributors' },
    ],
    selectedRootId: STORY_ROOT.id,
    selectedVariantSymbol: undefined,
    onSelectRoot: fn(),
    onSelectVariant: fn(),
    onCreatePrompt: fn(),
    canCreatePrompt: true,
    outline: (
      <PromptOutline
        sections={STORY_TREE.children}
        onSelect={fn()}
        onEdit={fn()}
        onAddAfter={fn()}
        onAddChild={fn()}
        onMove={fn()}
        onRemove={fn()}
      />
    ),
  },
  decorators: [
    (Story) => (
      <div className="studio h-[640px] w-full max-w-80 bg-card text-foreground">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Sidebar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Project: Story = {};
export const Empty: Story = { args: { catalog: [], outline: undefined } };
export const NoMatches: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.type(within(canvasElement).getByRole('searchbox', { name: 'Find a prompt' }), 'missing prompt');
  },
};
export const Mobile: Story = { parameters: { viewport: { defaultViewport: 'iphoneSE' } } };
