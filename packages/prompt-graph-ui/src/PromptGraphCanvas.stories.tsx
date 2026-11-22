/**
 * PromptGraphCanvas stories.
 *
 * `<PromptGraphCanvas>` is the only module permitted to import `@xyflow/react`
 * (see the component's module doc), and xyflow collapses to zero height
 * inside an auto-sized container — every story below is wrapped in a
 * decorator giving the canvas an explicit `700px` height and full width, or
 * it screenshots as an empty strip.
 *
 * `RealScoutPrompt` is the headline story: it builds its model from the real
 * `SCOUT_PROMPT` source via the actual parse → project pipeline
 * (`parsePromptTree` → `toGraphModel`), not a hand-written fixture — so what
 * a reviewer sees here is exactly what today's Scout prompt looks like as a
 * graph, diagnostics and all — including the `'declares'` edge labels
 * (`{{variable}}` / bare tool name) `toGraphModel` now populates, needing no
 * separate story: they fall straight out of the real model this story already builds.
 *
 * Every story built from `scoutModel` (`RealScoutPrompt`, `Default`, `WithSelection`,
 * `InteractiveEditing`, `CollapsedInCanvas`) is DELIBERATE drift detection, not an accident to guard
 * against: editing `SCOUT_PROMPT` changes these baselines visibly, by design — a reviewer diffing the
 * screenshot after a prompt-source edit is seeing that prompt change reflected, not a false regression.
 */

import type { PromptGraphModel, PromptTree, PromptTreeNode } from '@prompt-studio/prompts';
import { parsePromptTree, SCOUT_PROMPT, SCOUT_TOOLS, toGraphModel } from '@prompt-studio/prompts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent } from 'storybook/test';
import { PromptGraphCanvas } from './PromptGraphCanvas';

const meta: Meta<typeof PromptGraphCanvas> = {
  component: PromptGraphCanvas,
  title: 'Prompts/PromptGraphUi/PromptGraphCanvas',
  decorators: [
    (Story) => (
      <div className="h-[700px] w-full">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof PromptGraphCanvas>;

// ── Real Scout prompt, parsed live (not a fixture) ──────────────────────────

const scoutTree = parsePromptTree({
  key: 'scout',
  text: SCOUT_PROMPT,
  toolNames: SCOUT_TOOLS.map((tool) => tool.name),
});
const scoutModel = toGraphModel(scoutTree);
const scoutSectionId = scoutModel.nodes.find((node) => node.kind === 'section')?.id ?? scoutModel.nodes[0]?.id;

/** The real Scout agent system prompt (`SCOUT_PROMPT`), parsed and projected through the actual
 *  `parsePromptTree` → `toGraphModel` pipeline — root, every section (nested to their real depth),
 *  and every `{{variable}}`/tool-mention node the parser finds, exactly as production data would look. */
export const RealScoutPrompt: Story = {
  args: { model: scoutModel },
};

/** Named regression anchor: identical args to `RealScoutPrompt` (the real Scout prompt, parsed live)
 *  under Storybook's canonical `Default` export name, so tooling/reviewers that assume every
 *  component has a `Default` story find one here. `RealScoutPrompt` keeps its own descriptive name
 *  and doc above for humans browsing the sidebar — this export exists purely for the convention, not
 *  to replace it. */
export const Default: Story = {
  args: { model: scoutModel },
};

// ── Empty model ──────────────────────────────────────────────────────────────

const EMPTY_MODEL: PromptGraphModel = { nodes: [], edges: [] };

/** Zero nodes — the canvas mounts an empty xyflow pane (background grid + controls, no content). */
export const Empty: Story = {
  args: { model: EMPTY_MODEL },
};

// ── Single root + one section ───────────────────────────────────────────────

function buildEmptyTree(key: string): PromptTree {
  return { key, text: '', maxDepth: 0, children: [], tagClassifications: [], diagnostics: [] };
}

const SINGLE_SECTION_NODE: PromptTreeNode = {
  id: 'mission',
  title: 'YOUR MISSION',
  delimiter: 'caps-label',
  depth: 1,
  text: 'Find companies with delegation-ready hiring signals.',
  range: { start: 0, end: 0 },
  variables: [],
  toolMentions: [],
  children: [],
};

const SINGLE_SECTION_MODEL: PromptGraphModel = {
  nodes: [
    { id: 'root:scout', kind: 'root', label: 'scout', data: { kind: 'root', tree: buildEmptyTree('scout') } },
    {
      id: 'section:mission',
      kind: 'section',
      label: 'YOUR MISSION',
      parentId: 'root:scout',
      data: { kind: 'section', node: SINGLE_SECTION_NODE },
    },
  ],
  edges: [
    { id: 'contains:root:scout->section:mission', source: 'root:scout', target: 'section:mission', kind: 'contains' },
  ],
};

/** The smallest non-empty shape: one root node connected to a single section by a `'contains'` edge. */
export const SingleSection: Story = {
  args: { model: SINGLE_SECTION_MODEL },
};

// ── Selection ────────────────────────────────────────────────────────────────

/** A real section node id — taken from the actual `RealScoutPrompt` model, not hand-typed — is passed as
 *  `selectedNodeId`, so the corresponding `FragmentNode` renders with its selected ring/outline. */
export const WithSelection: Story = {
  args: { model: scoutModel, selectedNodeId: scoutSectionId },
};

// ── Ancestor-path selection highlight (selection-path.ts wiring) ────────────

/** A real depth-2 section under `SEARCH STRATEGY — 5 QUERY GROUPS` (e.g. `JOB POSTINGS (existing
 *  channels)`) — found from the actual `scoutModel`, not hand-typed — so this story documents the
 *  left-to-right ancestor-path readout on real production prompt structure: the parent `SEARCH
 *  STRATEGY` section and the `scout` root chip both render the subtler `ring-1 ring-ring/50` on-path
 *  treatment, the two connecting `contains` edges render the stronger primary-token stroke, and every
 *  other edge on the canvas dims — see `selection-path.ts`'s `selectionPath` and
 *  `PromptGraphCanvas`'s `selectionHighlight` memo for the underlying computation. */
const searchStrategySection = scoutModel.nodes.find(
  (node) => node.kind === 'section' && node.label.startsWith('SEARCH STRATEGY'),
);
const scoutDepth2SectionId =
  scoutModel.nodes.find((node) => node.kind === 'section' && node.parentId === searchStrategySection?.id)?.id ??
  scoutSectionId;

export const WithSelectionPath: Story = {
  args: { model: scoutModel, selectedNodeId: scoutDepth2SectionId },
};

// ── Edit-request wiring ──────────────────────────────────────────────────────

/**
 * Stateful wrapper wiring `onEditNode` to a visible "last edit request" panel, so a reviewer can
 * click any section card's edit (pencil) button and see this canvas's wiring actually fire — without
 * this file importing or rendering a dialog: the dialog itself is a concurrent task's scope, this
 * canvas only ever emits the node id via the callback.
 */
function InteractiveEditingDemo(): React.JSX.Element {
  const [lastEditRequestId, setLastEditRequestId] = useState<string | null>(null);
  return (
    <div className="flex h-full w-full flex-col gap-2">
      <div className="shrink-0 rounded-md border border-border bg-muted px-3 py-1.5 text-sm text-foreground">
        last edit request: <span className="font-mono">{lastEditRequestId ?? '(none yet)'}</span>
      </div>
      <div className="min-h-0 flex-1">
        <PromptGraphCanvas model={scoutModel} onEditNode={setLastEditRequestId} />
      </div>
    </div>
  );
}

export const InteractiveEditing: Story = {
  render: () => <InteractiveEditingDemo />,
};

// ── Bulk collapse ────────────────────────────────────────────────────────────

/**
 * The real Scout prompt with every section node collapsed to its one-line header form, reached via
 * `play()` clicking the "Collapse all sections" zoom-panel button right after mount — collapse state
 * is entirely canvas-internal (`PromptGraphCanvas`'s own `collapsedByNodeId` map), so this is the only
 * way to reach the all-collapsed state from a story without adding a prop surface just for one
 * screenshot.
 *
 * This story once existed to answer an open design question — whether collapsed cards keeping their
 * full 260px layout slots read as "a canvas full of awkward holes" — and the answer was yes: collapse
 * state is now a LAYOUT input (`layoutGraph`'s `collapsedNodeIds`), so each collapsed card consumes a
 * compact `LAYOUT_COLLAPSED_ROW_HEIGHT` slot and its whole column pulls up. What a reviewer should
 * see here is the COMPACTED overview: one dense column of one-line headers, no empty full-height
 * slots between them. (Positions-level behaviour is covered by `layout.test.ts` and
 * `PromptGraphCanvas.test.tsx`; this story is the visual readout.)
 */
export const CollapsedInCanvas: Story = {
  args: { model: scoutModel },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse all sections' }));
    await expect(canvas.getAllByRole('button', { name: 'Expand section' }).length).toBeGreaterThan(0);
  },
};

export const FileReferences: Story = {
  args: {
    model: toGraphModel(
      parsePromptTree({
        key: 'summary',
        text: '@references/rules.md\n# Summary\n## Instructions\nRead {{document}} and @references/rules.md.\n## Output\nUse path\\to\\windows\\file.txt.',
        toolNames: [],
      }),
    ),
  },
};

export const CollapsedSelectedActions: Story = {
  args: {
    model: toGraphModel(
      parsePromptTree({
        key: 'summary',
        text: '<mission>\nRead {{document}}\n</mission>\n<output>\nReturn evidence.\n</output>',
        toolNames: [],
      }),
    ),
    selectedNodeId: 'section:mission',
    onEditNode: () => undefined,
    onAddSiblingSection: () => undefined,
    onAddChildSection: () => undefined,
    onMoveSection: () => undefined,
    onRemoveSection: () => undefined,
    verificationByNodeId: { 'section:mission': { state: 'warning', findingCount: 1 } },
  },
  play: async ({ canvas, canvasElement }) => {
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse all sections' }));
    const cards = [...canvasElement.querySelectorAll('[data-testid="fragment-node"]')];
    await expect(cards).toHaveLength(2);
    const [first, second] = cards.map((card) => card.getBoundingClientRect());
    await expect(first.bottom).toBeLessThanOrEqual(second.top);
  },
};
