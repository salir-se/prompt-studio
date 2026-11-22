import '../index.css';
import { parsePromptTree, toGraphModel } from '@prompt-studio/prompts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, waitFor } from 'storybook/test';
import { GraphWorkspace } from './GraphWorkspace';
import { STORY_ROOT, STORY_TREE } from './studio-story-fixtures';

const model = toGraphModel(STORY_TREE);
const section = model.nodes.find((node) => node.kind === 'section');
const meta = {
  title: 'Prompts/PromptStudio/GraphWorkspace',
  component: GraphWorkspace,
  parameters: { layout: 'fullscreen' },
  args: { model, selectedRoot: STORY_ROOT },
  decorators: [
    (Story) => (
      <div className="studio h-[720px] bg-background">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof GraphWorkspace>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Default: Story = {};
export const Selected: Story = {
  render: function SelectedGraph(args) {
    const [id, setId] = useState(section?.id);
    return (
      <GraphWorkspace
        {...args}
        selectedNode={args.model.nodes.find((node) => node.id === id)}
        selectedNodeId={id}
        onSelectNode={setId}
        onCloseInspector={() => setId(undefined)}
      />
    );
  },
};
export const Empty: Story = { args: { model: { ...model, nodes: [], edges: [] } } };

/** #2536: the selected graph node owns native arrow movement; the viewport stays still. */
export const KeyboardNodeLayout: Story = {
  tags: ['test-ready'],
  args: { inspectorHidden: true },
  render: Selected.render,
  play: async ({ canvasElement }) => {
    const node = canvasElement.querySelector<HTMLElement>(`.react-flow__node[data-id="${section?.id}"]`);
    if (!node) throw new Error('The selected graph section is missing.');
    const viewport = canvasElement.querySelector<HTMLElement>('.react-flow__viewport')!;
    await waitFor(() => expect(node.clientWidth).toBeGreaterThan(0));
    const before = new DOMMatrix(node.style.transform).e;
    const view = viewport.style.transform;
    node.focus();
    for (let step = 0; step < 4; step++) await userEvent.keyboard('{ArrowRight}');
    await waitFor(() => expect(new DOMMatrix(node.style.transform).e).toBeGreaterThan(before));
    await expect(viewport.style.transform).toBe(view);
    await expect(node).toHaveFocus();
  },
};

/** #2540: moving a dependency below its source switches to the facing native handles. */
export const AdaptiveConnections: Story = {
  tags: ['test-ready'],
  args: {
    inspectorHidden: true,
    model: toGraphModel(parsePromptTree({ key: 'routing', text: '<mission>\nRead {{document}}.\n</mission>' })),
  },
  render: Selected.render,
  play: async ({ canvasElement }) => {
    const source = canvasElement.querySelector<HTMLElement>('.react-flow__node[data-id="section:mission"]')!;
    const target = canvasElement.querySelector<HTMLElement>('.react-flow__node[data-id="variable:document"]')!;
    await waitFor(() => expect(target.clientWidth).toBeGreaterThan(0));
    await userEvent.click(target);
    target.focus();
    const sourcePosition = new DOMMatrix(source.style.transform);
    const destination = {
      e: sourcePosition.e + (source.clientWidth - target.clientWidth) / 2,
      f: sourcePosition.f + source.clientHeight + 70,
    };
    for (const axis of ['e', 'f'] as const) {
      const delta = Math.round((destination[axis] - new DOMMatrix(target.style.transform)[axis]) / 5) * 5;
      const key = axis === 'e' ? (delta < 0 ? 'ArrowLeft' : 'ArrowRight') : delta < 0 ? 'ArrowUp' : 'ArrowDown';
      for (let count = 0; count < Math.floor(Math.abs(delta) / 20); count++) {
        await userEvent.keyboard(`{Shift>}{${key}}{/Shift}`);
      }
      for (let count = 0; count < (Math.abs(delta) % 20) / 5; count++) await userEvent.keyboard(`{${key}}`);
    }
    const path = canvasElement.querySelector<SVGPathElement>(
      '[data-id="declares:section:mission->variable:document"] .react-flow__edge-path',
    )!;
    const bounds = source.getBoundingClientRect();
    const handle = source.querySelector('[data-handleid="source-bottom"]')!.getBoundingClientRect();
    const zoom = bounds.height / source.offsetHeight;
    const anchorY = sourcePosition.f + (handle.bottom - bounds.top) / zoom;
    await waitFor(() => expect(path.getPointAtLength(0).y).toBeCloseTo(anchorY, 0));
    await expect(target).toHaveFocus();
  },
};
