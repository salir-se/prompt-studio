import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn, userEvent, within } from 'storybook/test';
import { ShortcutEducation } from '../shortcuts/ShortcutEducation';
import { TopBar, type TopBarProps } from './TopBar';
import { STORY_ROOT } from './studio-story-fixtures';

function CommandBar(args: TopBarProps) {
  const [view, setView] = useState<'write' | 'graph'>('write');
  return (
    <ShortcutEducation>
      <div className="studio min-h-52 bg-background text-foreground">
        <TopBar {...args} view={view} onViewChange={setView} />
      </div>
    </ShortcutEducation>
  );
}
const meta = {
  title: 'Prompts/PromptStudio/Commands',
  component: TopBar,
  beforeEach: ({ globals }) => {
    localStorage.setItem('prompt-studio-theme', globals.theme === 'dark' ? 'dark' : 'light');
    localStorage.removeItem('prompt-studio:compact-toolbars:v1');
  },
  parameters: { layout: 'fullscreen' },
  args: {
    selectedRoot: STORY_ROOT,
    isDirty: false,
    persistence: 'workspace',
    canUndo: false,
    projectPicker: null,
    canCreatePrompt: true,
    canOpenDesign: true,
    canOpenFinalPrompt: true,
    verifyDisabledReason: undefined,
    historyDisabledReason: undefined,
    helpOpen: false,
    canExport: true,
    onBrowsePrompts: fn(),
    onUndo: fn(),
    onCreatePrompt: fn(),
    onAddExisting: fn(),
    onAdaptDocument: fn(),
    onOpenDesign: fn(),
    onOpenFinalPrompt: fn(),
    onOpenTools: fn(),
    onOpenVariables: fn(),
    onVerify: fn(),
    onOpenHistory: fn(),
    onOpenHelp: fn(),
    onExport: fn(),
    onImport: fn(),
    onOpenPrompts: fn(),
    onOpenVersions: fn(),
    onOpenShare: fn(),
    onOpenRun: fn(),
    onOpenEvaluations: fn(),
  },
  render: CommandBar,
} satisfies Meta<typeof TopBar>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Desktop: Story = {};
export const LabelledToolbar: Story = {
  beforeEach: () => {
    localStorage.setItem('prompt-studio:compact-toolbars:v1', 'false');
  },
};
export const LongTitle: Story = {
  args: {
    selectedRoot: { ...STORY_ROOT, title: 'Document extraction for a multilingual archive of historical records' },
  },
};
export const Mobile: Story = { parameters: { viewport: { defaultViewport: 'iphoneSE' } } };
export const MobileFileMenu: Story = {
  ...Mobile,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^File$/ }));
  },
};
export const MobileToolsMenu: Story = {
  ...Mobile,
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^More tools$/ }));
  },
};
