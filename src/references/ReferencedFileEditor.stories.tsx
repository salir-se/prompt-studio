import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn } from 'storybook/test';
import '../index.css';
import { ReferencedFileEditor } from './ReferencedFileEditor';

const editor = {
  file: { path: 'skills/summary/references/rules.md', text: '# Evidence\nCite sources.', hash: 'baseline' },
  draft: '# Evidence\nCite primary sources and explain uncertainty.',
  dirty: true,
  loading: false,
  saving: false,
  error: undefined,
  saved: false,
  active: true,
  change: fn(),
  open: fn(async () => undefined),
  save: fn(async () => undefined),
  discard: fn(),
  close: fn(),
};
const meta = {
  title: 'Prompts/PromptStudio/ReferencedFile',
  component: ReferencedFileEditor,
  args: { editor },
  decorators: [
    (Story) => (
      <div className="studio h-[650px] w-full max-w-[420px] border bg-card">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ReferencedFileEditor>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Editing: Story = {};
export const Saving: Story = { args: { editor: { ...editor, saving: true } } };
export const Saved: Story = { args: { editor: { ...editor, dirty: false, saved: true } } };
export const Loading: Story = { args: { editor: { ...editor, file: undefined, dirty: false, loading: true } } };
export const OpenError: Story = {
  args: {
    editor: {
      ...editor,
      file: undefined,
      dirty: false,
      error: 'This file is not editable UTF-8 text. Export the project to edit it externally.',
    },
  },
};
export const SaveConflict: Story = {
  args: {
    editor: {
      ...editor,
      error:
        'rules.md changed since you opened it. Your draft is preserved. Copy it before reopening the saved version.',
    },
  },
};
