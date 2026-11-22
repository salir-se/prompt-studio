/**
 * LabelChip stories.
 *
 * `<LabelChip>` renders one `root`/`variable`/`tool` graph-node label as a
 * standalone chip. It has no graph dependency of its own — `PromptGraphCanvas`
 * wraps it (with non-interactive `Handle`s) for the `'label'` node type, but
 * every story here mounts it directly with hand-built props, matching the
 * component's "pure, props-only" contract — the same split `FragmentNode`'s
 * stories already establish for `'section'` nodes.
 *
 * Wrapped in a fixed-width decorator (`200px`, the chip's own fixed footprint)
 * so every story renders at the exact size the chip occupies inside
 * `PromptGraphCanvas`, rather than stretching to the Storybook canvas's full
 * width.
 */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, within } from 'storybook/test';
import { LabelChip } from './LabelChip';

const meta: Meta<typeof LabelChip> = {
  component: LabelChip,
  title: 'Prompts/PromptGraphUi/LabelChip',
  decorators: [
    (Story) => (
      <div className="w-[200px] bg-background p-4">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof LabelChip>;

/** `root` kind — a prompt's own key (e.g. `scout`). Neutral card colours, no tint. */
export const Root: Story = {
  args: { kind: 'root', label: 'scout' },
};

/** `variable` kind — a `{{variable}}` reference. Violet tint, matching `FragmentNode`'s variable chips. */
export const Variable: Story = {
  args: { kind: 'variable', label: 'company_name' },
};

/** THE named regression anchor for `LabelChip`'s visual baseline. Same args as `Variable` — `variable` is
 *  the most common label kind on a real prompt graph — but kept under a stable `Default` name so
 *  visual-regression tooling and reviewers always have one predictable story to diff against. */
export const Default: Story = {
  args: { ...Variable.args },
};

/** `tool` kind — a tool-name mention. Sky tint, matching `FragmentNode`'s tool chips. */
export const Tool: Story = {
  args: { kind: 'tool', label: 'web_search' },
};

/** Selected `variable` chip — the `ring-2 ring-ring` selection outline, as set by a containing canvas/list
 *  when this node is the current selection. Composes with the per-kind tint rather than replacing it. */
export const VariableSelected: Story = {
  args: { kind: 'variable', label: 'company_name', selected: true },
};

/** `onPath: true` — the subtler `ring-1 ring-ring/50` treatment `PromptGraphCanvas` applies to every
 *  ancestor of a selected node (see `selection-path.ts`'s `selectionPath`), distinct from both the
 *  idle (no ring) and `VariableSelected` (`ring-2 ring-ring`) states. */
export const OnPath: Story = {
  args: { kind: 'variable', label: 'company_name', onPath: true },
};

/** A very long, unbroken (no whitespace) label — proves `truncate` clips it with an ellipsis inside the
 *  fixed 200px-wide footprint instead of overflowing into whatever sits next to it on the canvas. */
export const LongLabel: Story = {
  args: {
    kind: 'tool',
    label: 'this_is_an_extremely_long_unbroken_tool_name_with_no_whitespace_anywhere_for_the_browser_to_wrap_on',
  },
  // #2504: a truncate class on a centered flex container can still hide the name's prefix.
  play: async ({ canvasElement, args }) => {
    await canvasElement.ownerDocument.fonts.ready;
    const chip = within(canvasElement).getByTestId('label-chip');
    const walker = chip.ownerDocument.createTreeWalker(chip, NodeFilter.SHOW_TEXT);
    const text = walker.nextNode() as Text;
    const prefix = chip.ownerDocument.createRange();
    prefix.setStart(text, 0);
    prefix.setEnd(text, 5);
    const bounds = chip.getBoundingClientRect();
    const padding = Number.parseFloat(getComputedStyle(chip).paddingLeft);
    await expect(bounds.width).toBe(200);
    await expect(bounds.height).toBe(36);
    await expect(chip).toHaveTextContent(args.label);
    await expect(chip).toHaveAttribute('title', args.label);
    await expect(prefix.getBoundingClientRect().left).toBeGreaterThanOrEqual(bounds.left + padding - 0.5);
    const labelStyle = getComputedStyle(text.parentElement ?? chip);
    await expect(labelStyle.textOverflow).toBe('ellipsis');
    await expect(labelStyle.overflow).toBe('hidden');
    await expect(labelStyle.whiteSpace).toBe('nowrap');
  },
};
