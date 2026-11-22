import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import { PromptWriter, type PromptWriterProps } from '../components/PromptWriter';

function Editor(args: PromptWriterProps) {
  const [text, setText] = useState(args.text);
  return (
    <div className="studio flex h-[min(720px,100dvh)] min-h-0 flex-col bg-background text-foreground">
      <PromptWriter {...args} text={text} onChange={setText} />
    </div>
  );
}
const meta = {
  title: 'Prompts/PromptStudio/Completion anchoring',
  component: PromptWriter,
  parameters: { layout: 'fullscreen' },
  args: {
    text: '<mission>\nRead the instructions.\n',
    dirty: true,
    variables: ['document'],
    tools: [],
    onApply: fn(),
    onDiscard: fn(),
    onChange: fn(),
  },
  render: Editor,
} satisfies Meta<typeof PromptWriter>;
export default meta;
type Story = StoryObj<typeof meta>;

async function completeNearCaret(canvasElement: HTMLElement) {
  const editor = within(canvasElement).getByRole('textbox', { name: 'Prompt markdown' }) as HTMLTextAreaElement;
  await userEvent.click(editor);
  await userEvent.keyboard('{Control>}{End}{/Control}');
  await userEvent.paste('{{doc');
  const menu = within(canvasElement.ownerDocument.body).getByRole('listbox', { name: 'Prompt suggestions' });
  // The real highlighted backdrop is an independent caret oracle, including wrapping/scroll.
  await waitFor(() => {
    const backdrop = within(canvasElement).getByTestId('highlighted-prompt-text-backdrop');
    const walker = backdrop.ownerDocument.createTreeWalker(backdrop, NodeFilter.SHOW_TEXT);
    let remaining = editor.selectionStart;
    let node = walker.nextNode() as Text | null;
    while (node && remaining > node.length) {
      remaining -= node.length;
      node = walker.nextNode() as Text | null;
    }
    if (!node || !remaining) throw new Error('Expected a text character before the caret');
    const range = node.ownerDocument.createRange();
    range.setStart(node, remaining - 1);
    range.setEnd(node, remaining);
    const caret = range.getBoundingClientRect();
    const popup = menu.getBoundingClientRect();
    expect(popup.left).toBeLessThanOrEqual(caret.right + 2);
    expect(popup.right).toBeGreaterThanOrEqual(caret.right - 2);
    expect(Math.min(Math.abs(popup.top - caret.bottom), Math.abs(caret.top - popup.bottom))).toBeLessThan(18);
    expect(popup.left).toBeGreaterThanOrEqual(0);
    expect(popup.right).toBeLessThanOrEqual(window.innerWidth);
    expect(popup.top).toBeGreaterThanOrEqual(0);
    expect(popup.bottom).toBeLessThanOrEqual(window.innerHeight);
  });
  await expect(editor).toHaveFocus();
}

/** #2512: completion follows the multiline caret instead of the writing workspace's right edge. */
export const MultilineCaret: Story = { play: ({ canvasElement }) => completeNearCaret(canvasElement) };
export const WrappedCaret: Story = {
  args: { text: `<mission>\n${'Use supplied evidence and preserve each instruction. '.repeat(22)}` },
  play: ({ canvasElement }) => completeNearCaret(canvasElement),
};
export const ScrolledCaret: Story = {
  args: { text: `<mission>\n${'Keep the existing instructions.\n'.repeat(60)}` },
  play: ({ canvasElement }) => completeNearCaret(canvasElement),
};

async function typeClosing(canvasElement: HTMLElement) {
  const editor = within(canvasElement).getByRole('textbox', { name: 'Prompt markdown' }) as HTMLTextAreaElement;
  await userEvent.click(editor);
  await userEvent.keyboard('{Control>}{End}{/Control}');
  await userEvent.type(editor, '</', { skipClick: true });
  return editor;
}
export const NestedClosingTags: Story = {
  args: { text: '<mission>\n<context>\nExisting instructions.\n' },
  play: async ({ canvasElement, args }) => {
    const editor = await typeClosing(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getAllByRole('option').map((option) => option.textContent)).toEqual([
      '</context>Close open tag',
      '</mission>Close open tag',
    ]);
    await expect(body.getAllByRole('option')[0]).toHaveAttribute('aria-selected', 'true');
    await expect(editor.value).toBe(`${args.text}</`);
    await userEvent.keyboard('{Enter}');
    await expect(editor.value).toBe(`${args.text}</context>`);
    await expect(editor).toHaveFocus();
  },
};
export const SoleClosingTag: Story = {
  args: { text: '<mission>\nExisting instructions.\n' },
  play: async ({ canvasElement, args }) => {
    const editor = await typeClosing(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await expect(body.getAllByRole('option')).toHaveLength(1);
    await expect(body.getByRole('option', { name: '</mission> Close open tag' })).toBeVisible();
    await expect(editor.value).toBe(`${args.text}</`);
    await userEvent.keyboard('{Tab}');
    await expect(editor.value).toBe(`${args.text}</mission>`);
  },
};
export const AlreadyClosedTags: Story = {
  args: { text: '<mission>\nDone.\n</mission>\n' },
  play: async ({ canvasElement }) => {
    await typeClosing(canvasElement);
    await expect(
      within(canvasElement.ownerDocument.body).queryByRole('listbox', { name: 'Prompt suggestions' }),
    ).not.toBeInTheDocument();
  },
};
