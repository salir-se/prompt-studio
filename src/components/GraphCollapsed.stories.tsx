import '../index.css';
import { PromptGraphCanvas } from '@prompt-studio/prompt-graph-ui';
import { parsePromptTree, toGraphModel } from '@prompt-studio/prompts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';

const model = toGraphModel(
  parsePromptTree({
    key: 'composing',
    text: '<mission>\nRead the document carefully.\n</mission>\n<output>\nReturn a summary.\n</output>',
  }),
);
const sections = model.nodes.filter((node) => node.kind === 'section');
const coverageByNodeId = Object.fromEntries(
  sections.map((node, index) => [
    node.id,
    {
      sectionId: `composing.${index}`,
      automatic: { basic: 1, custom: 0, status: 'stale' as const },
      ai: { generated: 3, custom: 0, status: 'not-checked' as const },
    },
  ]),
);
const meta = {
  title: 'Prompts/PromptStudio/Graph collapse',
  component: PromptGraphCanvas,
  parameters: { layout: 'fullscreen' },
  decorators: [
    (Story) => (
      <div className="studio h-[560px] bg-background">
        <Story />
      </div>
    ),
  ],
  args: {
    model,
    coverageByNodeId,
    selectedNodeId: sections[0]?.id,
    onEditNode: fn(),
    onOpenVerification: fn(),
    onAddChildSection: fn(),
    onAddSiblingSection: fn(),
    onMoveSection: fn(),
    onRemoveSection: fn(),
  },
} satisfies Meta<typeof PromptGraphCanvas>;
export default meta;
type Story = StoryObj<typeof meta>;

export const CollapsedAtEveryZoom: Story = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse all sections' }));
    const cards = canvas.getAllByTestId('fragment-node');
    for (const card of cards) {
      await expect(card).toHaveAttribute('data-collapsed', 'true');
      await expect(card.clientHeight).toBeLessThanOrEqual(56);
      await expect(within(card).getByRole('button', { name: 'Edit section' })).toBeVisible();
    }
    await userEvent.click(within(cards[0]!).getByRole('button', { name: 'Edit section' }));
    await expect(args.onEditNode).toHaveBeenCalledWith(sections[0]?.id);
    for (let step = 0; step < 4; step++) await userEvent.click(canvas.getByRole('button', { name: /^zoom out$/i }));
    await waitFor(() => expect(canvas.getByTestId('prompt-graph-canvas')).toHaveAttribute('data-zoomed-out'));
    const zoomedCards = canvas.getAllByTestId('fragment-node');
    for (const card of zoomedCards)
      await expect(within(card).getByRole('button', { name: 'Expand section' })).toBeVisible();
    const first = within(zoomedCards[0]!);
    await userEvent.click(first.getByRole('button', { name: /Automatic checks/ }));
    await expect(args.onOpenVerification).toHaveBeenCalledWith('composing.0', 'checks');
    await userEvent.click(first.getByRole('button', { name: 'Section actions' }));
    await userEvent.click(within(document.body).getByRole('menuitem', { name: 'Add sub-section' }));
    await expect(args.onAddChildSection).toHaveBeenCalledWith(sections[0]?.id);
    await waitFor(() => expect(canvas.getAllByRole('button', { name: 'Expand section' })).toHaveLength(2));
    const expand = within(canvas.getAllByTestId('fragment-node')[0]!).getByRole('button', { name: 'Expand section' });
    expand.focus();
    await userEvent.keyboard('{Enter}');
    await expect(canvas.getAllByTestId('fragment-node')[0]!).toHaveAttribute('data-collapsed', 'false');
    await expect(canvas.getByText('Read the document carefully.')).toBeVisible();
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse all sections' }));
    await userEvent.click(canvas.getByRole('button', { name: /^fit view$/i }));
  },
};
export const Expanded: Story = {};

export const ReferenceLabelSpacing: Story = {
  args: {
    model: toGraphModel(
      parsePromptTree({
        key: 'references',
        text: `<mission>
Read {{document}} and {{source_${'reference_'.repeat(8)}}}.
<evidence>
Check {{document}} before drawing conclusions.
</evidence>
</mission>
<output>
Summarize {{document}}.
</output>`,
      }),
    ),
    selectedNodeId: undefined,
    coverageByNodeId: undefined,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const assertClearance = async () => {
      await waitFor(() => {
        const viewport = canvasElement.querySelector('.react-flow__viewport');
        const zoom = new DOMMatrix(getComputedStyle(viewport!).transform).a;
        const labels = canvasElement.querySelectorAll('.react-flow__edge-textbg');
        expect(labels.length).toBeGreaterThan(0);
        for (const label of labels) {
          const box = label.getBoundingClientRect();
          expect(box.width).toBeGreaterThan(0);
          for (const node of canvasElement.querySelectorAll('.react-flow__node')) {
            const bounds = node.getBoundingClientRect();
            const dx = Math.max(bounds.left - box.right, box.left - bounds.right, 0);
            const dy = Math.max(bounds.top - box.bottom, box.top - bounds.bottom, 0);
            expect(Math.hypot(dx, dy) / zoom).toBeGreaterThanOrEqual(15.5);
          }
        }
      });
    };
    await assertClearance();
    await userEvent.click(canvas.getByRole('button', { name: 'Collapse all sections' }));
    await assertClearance();
    for (let step = 0; step < 3; step++) await userEvent.click(canvas.getByRole('button', { name: /^zoom out$/i }));
    await assertClearance();
    await userEvent.click(canvas.getByRole('button', { name: /^fit view$/i }));
    await assertClearance();
  },
};
