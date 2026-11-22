import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { WORKFLOW_PATTERNS } from '../design/workflow-patterns';
import { useStudioShortcuts } from '../hooks/use-studio-shortcuts';
import { PromptWriter, type PromptWriterProps } from './PromptWriter';
import { STORY_TEXT } from './studio-story-fixtures';

function WritingStory(args: PromptWriterProps) {
  const [source, setSource] = useState(args.dirty ? '' : args.text);
  const [draft, setDraft] = useState(args.text);
  return (
    <div className="studio flex h-[min(720px,100dvh)] min-h-0 flex-col bg-background text-foreground">
      <PromptWriter
        {...args}
        text={draft}
        dirty={draft !== source}
        onChange={setDraft}
        onApply={() => {
          setSource(draft);
          args.onApply();
        }}
        onDiscard={() => {
          setDraft(source);
          args.onDiscard();
        }}
      />
    </div>
  );
}
const meta = {
  component: PromptWriter,
  title: 'Prompts/PromptStudio/Writer',
  parameters: { layout: 'fullscreen' },
  args: {
    text: STORY_TEXT,
    dirty: false,
    variables: ['document'],
    tools: [],
    onChange: fn(),
    onApply: fn(),
    onDiscard: fn(),
  },
  render: WritingStory,
} satisfies Meta<typeof PromptWriter>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Applied: Story = {};
export const UnappliedDraft: Story = { args: { dirty: true } };
export const SourceChanged: Story = { args: { dirty: true, stale: true } };
export const Empty: Story = { args: { text: '' } };
export const LongPrompt: Story = { args: { text: STORY_TEXT.repeat(35) } };
export const Mobile: Story = { parameters: { viewport: { defaultViewport: 'iphoneSE' } } };

export const VariableSuggestions: Story = {
  args: { text: '' },
  play: async ({ canvasElement }) => {
    const editor = within(canvasElement).getByRole('textbox', { name: 'Prompt markdown' });
    await userEvent.click(editor);
    await userEvent.paste('{{doc');
    await expect(
      within(canvasElement.ownerDocument.body).getByRole('listbox', { name: 'Prompt suggestions' }),
    ).toBeVisible();
  },
};
export const XmlSuggestions: Story = {
  args: { text: '<mission>\n<context>\nUse supplied evidence.\n' },
  play: async ({ canvasElement }) => {
    await userEvent.type(within(canvasElement).getByRole('textbox', { name: 'Prompt markdown' }), '</');
    await expect(
      within(canvasElement.ownerDocument.body).getByRole('option', { name: '</context> Close open tag' }),
    ).toBeVisible();
  },
};
export const InsertSubsection: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('textbox', { name: 'Prompt markdown' }));
    await userEvent.click(within(canvasElement).getByRole('button', { name: '+ Section' }));
    await userEvent.type(
      within(canvasElement.ownerDocument.body).getByRole('textbox', { name: 'Section name' }),
      'evidence_rules',
    );
  },
};
export const DraftSectionJump: Story = {
  args: {
    text: `${STORY_TEXT}\n<new_unsaved_section>\nThese instructions exist only in the writing draft.\n</new_unsaved_section>`,
    dirty: true,
  },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: /^Sections/ }));
    await userEvent.type(
      within(canvasElement.ownerDocument.body).getByRole('combobox', { name: 'Find section' }),
      'unsaved',
    );
    await expect(
      within(canvasElement.ownerDocument.body).getByRole('option', { name: /new_unsaved_section/ }),
    ).toBeVisible();
  },
};
export const WorkflowInstructions: Story = {
  args: { workflow: WORKFLOW_PATTERNS.find((pattern) => pattern.id === 'parallel')!.graph },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Workflow steps' }));
  },
};
export const CustomWorkflow: Story = {
  args: { workflow: 'flowchart LR\n A --> B' },
  play: WorkflowInstructions.play,
};
export const InsertionUnavailable: Story = {
  play: async ({ canvasElement }) => {
    const doc = canvasElement.ownerDocument;
    const original = doc.execCommand;
    doc.execCommand = () => false;
    try {
      await userEvent.click(within(canvasElement).getByRole('button', { name: '+ Section' }));
      await userEvent.type(within(doc.body).getByRole('textbox', { name: 'Section name' }), 'details');
      await userEvent.click(within(doc.body).getByRole('button', { name: 'Add section' }));
      await expect(within(canvasElement).getByRole('alert')).toHaveTextContent('Your draft is kept');
    } finally {
      doc.execCommand = original;
    }
  },
};

export const JumpRevealsOffscreenSource: Story = {
  args: { text: `<mission>\n${'Keep existing instructions.\n'.repeat(80)}</mission>\n\n<last>\nWrite here.\n</last>` },
  play: async ({ canvasElement, args }) => {
    const editor = within(canvasElement).getByRole('textbox', { name: 'Prompt markdown' }) as HTMLTextAreaElement;
    await userEvent.click(editor);
    await userEvent.keyboard('{Control>}{Home}{/Control}');
    await expect(editor.selectionStart).toBe(0);
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await expect(editor).toHaveFocus();
    await expect(editor.selectionStart).toBe(args.text.indexOf('Write here.'));
    await expect(editor.scrollTop).toBeGreaterThan(0);
  },
};

export const WorkflowJumpRevealsOffscreenSource: Story = {
  args: {
    workflow: WORKFLOW_PATTERNS.find((pattern) => pattern.id === 'sequential')!.graph,
    text: `<mission>\n${'Keep existing instructions.\n'.repeat(80)}</mission>\n\n<step_sequential_draft>\nWrite here.\n</step_sequential_draft>`,
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const editor = canvas.getByRole('textbox', { name: 'Prompt markdown' }) as HTMLTextAreaElement;
    await userEvent.click(canvas.getByRole('button', { name: 'Workflow steps' }));
    await userEvent.click(
      within(canvasElement.ownerDocument.body).getByRole('button', { name: /^Draft · Open instructions/ }),
    );
    await expect(editor).toHaveFocus();
    await expect(editor.selectionStart).toBe(args.text.indexOf('Write here.'));
    await expect(editor.scrollTop).toBeGreaterThan(0);
  },
};

function ShortcutWritingStory(args: PromptWriterProps) {
  useStudioShortcuts({ enabled: true, explorer: () => {}, changeView: () => true, verify: () => {} });
  return <WritingStory {...args} />;
}

/** #2530: Alt+1 reveals Markdown from Preview through the real workspace shortcut, retaining the native editor. */
export const ReturnFromPreview: Story = {
  tags: ['test-ready'],
  render: ShortcutWritingStory,
  args: { dirty: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const editor = canvas.getByRole('textbox', { name: 'Prompt markdown' });
    await userEvent.click(canvas.getByRole('tab', { name: 'Preview draft' }));
    await expect(editor).not.toBeVisible();
    await userEvent.keyboard('{Alt>}1{/Alt}');
    await waitFor(() => expect(editor).toBeVisible());
    await waitFor(() => expect(editor).toHaveFocus());
    await expect(canvas.getByRole('tab', { name: 'Markdown' })).toHaveAttribute('aria-selected', 'true');
    await expect(canvas.getByRole('textbox', { name: 'Prompt markdown' })).toBe(editor);
    await expect(editor).toHaveValue(STORY_TEXT);
  },
};

/** #2534: search and adjacent-section keys land inside supported same-line label bodies. */
export const CapsLabelSectionNavigation: Story = {
  tags: ['test-ready'],
  args: { text: 'MISSION: Write a short answer.\n\nOUTPUT: JSON only.', dirty: true },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const editor = canvas.getByRole('textbox', { name: 'Prompt markdown' }) as HTMLTextAreaElement;
    await userEvent.click(editor);
    await userEvent.keyboard('{Alt>}j{/Alt}');
    await userEvent.click(within(canvasElement.ownerDocument.body).getByRole('option', { name: /MISSION/ }));
    await waitFor(() => expect(editor).toHaveFocus());
    await expect(editor.selectionStart).toBe(args.text.indexOf('Write'));
    await userEvent.keyboard('{Alt>}{ArrowDown}{/Alt}');
    await expect(editor.selectionStart).toBe(args.text.indexOf('JSON'));
    await userEvent.keyboard('{Alt>}{ArrowUp}{/Alt}');
    await expect(editor.selectionStart).toBe(args.text.indexOf('Write'));
    await expect(editor).toHaveFocus();
    await expect(editor).toHaveValue(args.text);
    await expect(args.onApply).not.toHaveBeenCalled();
  },
};
