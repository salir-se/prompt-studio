import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import { StatusBar } from './StatusBar';

const meta = {
  component: StatusBar,
  title: 'Prompts/PromptStudio/StatusBar',
  args: {
    diagnosticsCount: 0,
    nodeCount: 12,
    edgeCount: 11,
    text: 'Design a concise prompt with a measurable output. '.repeat(24),
    verificationFindingsCount: 2,
    undeclaredCount: 1,
    docLevelFindingsCount: 1,
    onOpenUndeclared: fn(),
    onOpenVerifyDrawer: fn(),
  },
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof StatusBar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Mobile: Story = {
  parameters: { viewport: { defaultViewport: 'iphoneSE' } },
};
