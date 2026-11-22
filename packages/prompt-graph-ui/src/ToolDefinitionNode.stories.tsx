/**
 * ToolDefinitionNode stories.
 *
 * `<ToolDefinitionNode>` renders one tool's contract (name, description,
 * input keys) as a standalone, read-only card — the "definition node" for
 * ADR-202 §7's read-only registry projections. It has no graph dependency
 * of its own; a future canvas node wraps it, but every story here mounts it
 * directly with hand-built props, matching `FragmentNode`'s "pure,
 * props-only" contract.
 *
 * The component sets its own fixed 360px footprint (matching `FragmentNode`'s
 * `fixedSize` card width), so the decorator here only supplies background and
 * breathing-room padding rather than a width constraint of its own.
 */

import type { Decorator, Meta, StoryObj } from '@storybook/react-vite';
import { ToolDefinitionNode } from './ToolDefinitionNode';

const meta: Meta<typeof ToolDefinitionNode> = {
  component: ToolDefinitionNode,
  title: 'Prompts/PromptGraphUi/ToolDefinitionNode',
};
export default meta;

type Story = StoryObj<typeof ToolDefinitionNode>;

/** Fixed-footprint wrapper for every single-card story — the card itself is a fixed 360px width, so this
 *  decorator only adds background and padding, not a competing width constraint. */
const narrow: Decorator = (Story) => (
  <div className="w-fit bg-background p-4">
    <Story />
  </div>
);

/** `source: 'builtin'` — a `@prompt-studio/tools` `ToolRegistry` entry, with a description and input keys. */
export const Builtin: Story = {
  decorators: [narrow],
  args: {
    name: 'web_search',
    source: 'builtin',
    description:
      'Search the web for public information — job postings, funding news, and company sites — to gather delegation-readiness signals.',
    inputKeys: ['query', 'max_results'],
  },
};

/** THE named regression anchor for `ToolDefinitionNode`'s visual baseline. Same args as `Builtin` — a
 *  built-in tool with a description and input keys is the dominant case a reviewer sees. */
export const Default: Story = {
  decorators: [narrow],
  args: { ...Builtin.args },
};

/** `source: 'mcp'` with `serverLabel` given — shows `mcp · zai` per ADR-013's `McpServerConfig` metadata. */
export const McpTool: Story = {
  decorators: [narrow],
  args: {
    name: 'zai_web_search',
    source: 'mcp',
    serverLabel: 'zai',
    description: "Query z.ai's hosted search index for the same signal categories as the built-in web_search tool.",
    inputKeys: ['query'],
  },
};

/** No `description` — proves the description paragraph is omitted entirely rather than rendering an empty
 *  or placeholder line, matching `FragmentNode`'s "no chip row when there's nothing to show" convention. */
export const NoDescription: Story = {
  decorators: [narrow],
  args: {
    name: 'save_lead',
    source: 'builtin',
    inputKeys: ['company_name', 'signal_score'],
  },
};

/** Selected state — `aria-current="true"` and the `ring-2 ring-ring` selection outline, as set by a
 *  containing canvas/list when this node is the current selection. */
export const Selected: Story = {
  decorators: [narrow],
  args: { ...Builtin.args, selected: true },
};
