/**
 * SkillMountNode stories.
 *
 * `<SkillMountNode>` renders one skill mount point as a standalone, collapsed
 * card — the "skill definition node" ADR-202 §6 specifies: `name@version` +
 * mount tag, redacted by default, NEVER the skill's body. It has no graph
 * dependency of its own and no dependency on `@prompt-studio/skills` loaders — see
 * the component's own module doc for why that's load-bearing, not incidental.
 *
 * The component sets its own fixed 360px footprint (matching `FragmentNode`'s
 * `fixedSize` card width), so the decorator here only supplies background and
 * breathing-room padding rather than a width constraint of its own.
 */

import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { SkillMountNode } from './SkillMountNode';

const meta: Meta<typeof SkillMountNode> = {
  component: SkillMountNode,
  title: 'Prompts/PromptGraphUi/SkillMountNode',
};
export default meta;

type Story = StoryObj<typeof SkillMountNode>;

/** Fixed-footprint wrapper for every single-card story — the card itself is a fixed 360px width, so this
 *  decorator only adds background and padding, not a competing width constraint. */
const narrow: Decorator = (Story) => (
  <div className="w-fit bg-background p-4">
    <Story />
  </div>
);

/** The default, safe posture: `sales-humanizer@1` mounted at `<session_learning_closeout>`, redacted.
 *  This is what every caller gets unless it explicitly opts into `redacted: false` — matching ADR-202 §6's
 *  "redacted by default" rule and ADR-089's per-agent skill registry (`AGENT_SKILLS['sales-humanizer']`). */
export const Redacted: Story = {
  decorators: [narrow],
  args: {
    name: 'sales-humanizer',
    label: 'Sales humanizer',
    version: '1',
    mountTag: 'session_learning_closeout',
  },
};

/** THE named regression anchor for `SkillMountNode`'s visual baseline. Same args as `Redacted` — the
 *  default, safe posture is the dominant case a reviewer sees. */
export const Default: Story = {
  decorators: [narrow],
  args: { ...Redacted.args },
};

/** `redacted: false` with a non-sensitive `summary` — proves the summary renders in place of the
 *  redaction notice without ever implying the component fetched or holds the skill's protected body. */
export const WithSummary: Story = {
  decorators: [narrow],
  args: {
    ...Redacted.args,
    redacted: false,
    summary: 'Rewrites outbound drafts to read as natural, human-written messages before the Closer sends them.',
  },
};

/** Selected state — `aria-current="true"` and the `ring-2 ring-ring` selection outline, as set by a
 *  containing canvas/list when this node is the current selection. */
export const Selected: Story = {
  decorators: [narrow],
  args: { ...Redacted.args, selected: true },
};
