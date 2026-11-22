/**
 * FragmentEditDialog stories.
 *
 * `<FragmentEditDialog>` is a transactional editor over one prompt section's
 * markdown (ADR-200/ADR-202). It has no data-fetching or graph dependency of
 * its own — every story below hand-builds props/state, matching the
 * component's "props only, caller owns persistence" contract.
 *
 * `mode` (Raw/Rendered) is internal state, not a prop, so `RenderedMode`
 * drives it via a `play` function that clicks the toggle after mount rather
 * than an arg — this is also what makes it screenshot correctly for visual
 * review (Level 4 capture runs stories with their `play` function applied).
 */

import { Button } from '@prompt-studio/ui/button';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, fn, userEvent, within } from 'storybook/test';
import { FragmentEditDialog } from './FragmentEditDialog';

const meta: Meta<typeof FragmentEditDialog> = {
  component: FragmentEditDialog,
  title: 'Prompts/PromptGraphUi/FragmentEditDialog',
  args: {
    onApply: fn(),
    onCancel: fn(),
  },
};
export default meta;

type Story = StoryObj<typeof FragmentEditDialog>;

// A realistic section body — variables, a mix of known/unknown, tool mentions,
// and an XML-ish structure tag — so Raw mode visibly exercises all four
// highlight colours (violet/amber/sky/emerald) at once.
const PROMPT_LIKE_TEXT = `You are the Closer agent for {{product_name}}.

Match the tone described by {{style_profile}} and sign as {{sender_name}}.

<special_skill>
Draft in the voice of {{style_profile}}.
</special_skill>

Available tools: draft_email, update_status, publish_order.

Legacy placeholder {{persona_slug}} is no longer supported — remove it from custom drafts.`;

const KNOWN_VARIABLES = ['product_name', 'style_profile', 'sender_name'];
const TOOL_NAMES = ['draft_email', 'update_status', 'publish_order'];

// ── RawMode ──────────────────────────────────────────────────────────────────

/** Default state: open, Raw mode, a prompt-like body with variables/tools/tags all visibly
 *  highlighted — violet for known variables, amber for the unknown one, sky for tools, emerald
 *  for the `<special_skill>` tag pair. */
export const RawMode: Story = {
  args: {
    open: true,
    title: 'Closer Persona',
    initialText: PROMPT_LIKE_TEXT,
    knownVariables: KNOWN_VARIABLES,
    toolNames: TOOL_NAMES,
  },
  play: async ({ canvasElement }) => {
    // #2980: the rounded focus ring must fit inside the full-width editor.
    const editor = within(canvasElement.ownerDocument.body).getByRole('textbox', { name: 'Closer Persona markdown' });
    editor.focus({ preventScroll: true });
    await expect(getComputedStyle(editor).boxShadow).toContain('inset');
    editor.blur();
  },
};

// ── RenderedMode ─────────────────────────────────────────────────────────────

/** Same content as `RawMode`, switched to the read-only Rendered preview via a `play` function
 *  (mode is internal state, not a prop) — proves the Markdown preview renders the section body. */
export const RenderedMode: Story = {
  args: { ...RawMode.args },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    await userEvent.click(await page.findByRole('button', { name: 'Rendered' }));
    await expect(page.getByTestId('fragment-edit-dialog-rendered')).toBeInTheDocument();
  },
};

// ── LongDocument ─────────────────────────────────────────────────────────────

const LONG_DOCUMENT_TEXT = Array.from(
  { length: 140 },
  (_, i) => `Line ${i + 1}: verifying the dialog scrolls internally instead of growing past its fixed height.`,
).join('\n');

/** A 140-line section body — the dialog stays at its fixed `h-[85vh]` footprint and the editor
 *  region scrolls internally (Cancel/Apply stay pinned and reachable), rather than the whole
 *  dialog growing to fit the content. */
export const LongDocument: Story = {
  args: {
    open: true,
    title: 'Detailed Methodology',
    initialText: LONG_DOCUMENT_TEXT,
  },
};

// ── Transactional ────────────────────────────────────────────────────────────

/** Stateful demo wrapper: a trigger button opens the dialog seeded from the panel's current
 *  applied text; Apply writes the edited draft back to the panel and closes, Cancel closes
 *  without touching it. This is the end-to-end proof that the transactional contract holds —
 *  not just that `onApply`/`onCancel` fire, but that the CALLER'S state only ever changes via
 *  Apply. */
function TransactionalDemo(): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [appliedText, setAppliedText] = useState('Find companies with delegation-ready hiring signals.');

  return (
    <div className="flex max-w-xl flex-col gap-3 bg-background p-4 text-foreground">
      <Button type="button" onClick={() => setOpen(true)}>
        Edit section
      </Button>
      <div
        data-testid="applied-text-panel"
        className="whitespace-pre-wrap rounded-md border bg-muted p-3 font-mono text-sm"
      >
        {appliedText}
      </div>
      <FragmentEditDialog
        open={open}
        title="Your Mission"
        initialText={appliedText}
        knownVariables={['icp', 'persona']}
        toolNames={['web_search', 'save_lead']}
        onApply={(text) => {
          setAppliedText(text);
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}

/** Applying an edit updates the "applied text" panel; cancelling leaves it untouched — driven
 *  through the real trigger button and dialog, not hand-called props. */
export const Transactional: Story = {
  render: () => <TransactionalDemo />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(canvasElement.ownerDocument.body);

    await userEvent.click(canvas.getByRole('button', { name: 'Edit section' }));
    const textarea = await page.findByRole('textbox', { name: 'Your Mission markdown' });
    await userEvent.clear(textarea);
    await userEvent.type(textarea, 'Find companies with delegation-ready hiring signals, urgently.');
    await userEvent.click(page.getByRole('button', { name: 'Apply' }));

    await expect(canvas.getByTestId('applied-text-panel')).toHaveTextContent(
      'Find companies with delegation-ready hiring signals, urgently.',
    );
  },
};

/** #2521 / D014: a failed Apply keeps the draft available to copy before reopening. */
export const FailedApply: Story = {
  render: function FailedApplyDemo() {
    const [error, setError] = useState<string>();
    return (
      <FragmentEditDialog
        open
        title="Workflow Instructions Sequential"
        initialText={PROMPT_LIKE_TEXT}
        knownVariables={KNOWN_VARIABLES}
        toolNames={TOOL_NAMES}
        error={error}
        onApply={() =>
          setError(
            'The prompt changed while this section was open. Copy your edits, then cancel and reopen the section.',
          )
        }
        onCancel={fn()}
      />
    );
  },
  play: async ({ canvasElement }) => {
    const page = within(canvasElement.ownerDocument.body);
    const editor = await page.findByRole('textbox');
    await userEvent.clear(editor);
    await userEvent.type(editor, 'Keep my unfinished workflow instructions.');
    await userEvent.click(page.getByRole('button', { name: 'Apply' }));
    await expect(editor).toHaveValue('Keep my unfinished workflow instructions.');
    await expect(page.getByRole('alert')).toHaveTextContent('Copy your edits, then cancel and reopen the section.');
    const heading: HTMLElement = page.getByRole('heading', { name: 'Workflow Instructions Sequential' });
    const close = page.getByRole('button', { name: 'Close' }).getBoundingClientRect();
    const titleText = heading.ownerDocument.createRange();
    titleText.selectNodeContents(heading);
    const overlapsClose = Array.from(titleText.getClientRects()).some(
      (rect) =>
        rect.left < close.right && rect.right > close.left && rect.top < close.bottom && rect.bottom > close.top,
    );
    await expect(overlapsClose).toBe(false);
  },
};
