import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { fn } from 'storybook/test';
import { AppBanners, type AppBannersProps } from './AppBanners';
import { PromptWriter } from './PromptWriter';
import { STORY_TEXT } from './studio-story-fixtures';

function FeedbackWorkspace(args: AppBannersProps) {
  const [text, setText] = useState(STORY_TEXT);
  const [notice, setNotice] = useState(args.noticeMessage);
  return (
    <div className="studio flex h-dvh flex-col bg-background text-foreground">
      <div className="flex min-h-0 flex-1">
        <PromptWriter
          text={text}
          dirty
          variables={['document']}
          tools={[]}
          onChange={setText}
          onApply={fn()}
          onDiscard={fn()}
        />
      </div>
      <AppBanners {...args} noticeMessage={notice} onDismissNotice={() => setNotice(null)} />
    </div>
  );
}
const meta = {
  title: 'Prompts/PromptStudio/WorkspaceFeedback',
  component: AppBanners,
  parameters: { layout: 'fullscreen' },
  args: { errorMessage: null, noticeMessage: null, degradedReason: null, onDismissDegraded: fn() },
  render: FeedbackWorkspace,
} satisfies Meta<typeof AppBanners>;
export default meta;
type Story = StoryObj<typeof meta>;
export const CreatedWhileWriting: Story = {
  args: { noticeMessage: 'Created “Document summary”. Write your prompt; new sections are set up automatically.' },
};
export const SaveFailureWithHistoryFallback: Story = {
  args: {
    errorMessage: 'Your changes could not be saved. Keep this tab open and retry saving.',
    degradedReason: 'Browser persistence is unavailable; working changes remain in this session.',
  },
};
