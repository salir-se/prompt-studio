import '../index.css';
import { parsePromptTree, toGraphModel } from '@prompt-studio/prompts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, within } from 'storybook/test';
import { Inspector } from './Inspector';
import { STORY_ROOT } from './studio-story-fixtures';

const model = toGraphModel(
  parsePromptTree({
    key: 'account-research',
    text: '## Mission\n\n<mission>\nResearch the account and verify the evidence.\n</mission>\n',
    toolNames: [],
  }),
);
const sectionNode = model.nodes.find((node) => node.data.kind === 'section');

const meta = {
  component: Inspector,
  title: 'Prompts/PromptStudio/Inspector',
  args: {
    node: sectionNode,
    model,
    selectedRoot: undefined,
    onEditSection: fn(),
    onDesignSection: fn(),
  },
  decorators: [
    (Story) => (
      <div
        data-testid="inspector-story-surface"
        className="studio min-h-[620px] w-[340px] border-l border-border bg-card text-foreground"
      >
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Inspector>;

export default meta;
type Story = StoryObj<typeof meta>;

export const AuthoredSection: Story = {};

const fileModel = toGraphModel(
  parsePromptTree({
    key: 'summary',
    text: '@references/rules.md\n## Instructions\nRead @references/rules.md and path\\to\\windows\\file.txt.',
    toolNames: [],
  }),
);
export const FileReference: Story = {
  args: { model: fileModel, node: fileModel.nodes.find((node) => node.kind === 'file') },
};

const longVariable = `source_${'document_'.repeat(12)}identifier`;
const longTool = `verify_${'source_documents_'.repeat(8)}before_answering`;
const longSection = `evidence_${'requirements_'.repeat(10)}section`;
const longOwner = `AUTHOR_${'CONFIGURATION_'.repeat(12)}OWNER`;
const longModel = toGraphModel(
  parsePromptTree({
    key: 'inspector-containment',
    text: `<mission>\nUse {{${longVariable}}} with ${longTool}.\n</mission>`,
    toolNames: [longTool],
  }),
);
const longSectionNode = longModel.nodes.find((node) => node.data.kind === 'section')!;
const namedModel = {
  ...longModel,
  nodes: longModel.nodes.map((node) =>
    node.data.kind === 'section'
      ? { ...node, label: longSection, data: { ...node.data, node: { ...node.data.node, title: longSection } } }
      : node,
  ),
};
// #2505: full names must wrap; measuring text catches clipping hidden by an ancestor.
async function assertInspectorContainment(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  const surface = canvas.getByTestId('inspector-story-surface');
  const bounds = surface.getBoundingClientRect();
  await expect(surface.scrollWidth).toBeLessThanOrEqual(surface.clientWidth + 1);
  await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth + 1);
  for (const element of surface.querySelectorAll('h2, dd, li')) {
    const range = document.createRange();
    range.selectNodeContents(element);
    for (const rect of range.getClientRects()) {
      await expect(rect.left).toBeGreaterThanOrEqual(bounds.left - 1);
      await expect(rect.right).toBeLessThanOrEqual(bounds.right + 1);
    }
  }
  return canvas;
}
export const LongSectionNames: Story = {
  tags: ['test-ready'],
  args: { model: namedModel, node: namedModel.nodes.find((node) => node.id === longSectionNode.id) },
  play: async ({ canvasElement }) => {
    const canvas = await assertInspectorContainment(canvasElement);
    await expect(canvas.getByRole('heading', { name: longSection })).toBeVisible();
    await expect(canvas.getByRole('list', { name: 'Variables' })).toHaveTextContent(longVariable);
    await expect(canvas.getByRole('list', { name: 'Tools' })).toHaveTextContent(longTool);
  },
};
export const LongRootMetadata: Story = {
  tags: ['test-ready'],
  args: {
    model: namedModel,
    node: namedModel.nodes.find((node) => node.kind === 'root'),
    selectedRoot: {
      ...STORY_ROOT!,
      title: longSection,
      ownerLabel: longOwner,
      toolNames: [longTool],
      protectedSkills: [longVariable],
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = await assertInspectorContainment(canvasElement);
    await expect(canvas.getByRole('heading', { name: longSection })).toBeVisible();
    await expect(canvas.getByText(longOwner)).toBeVisible();
  },
};
export const LongReferencingSections: Story = {
  tags: ['test-ready'],
  args: { model: namedModel, node: namedModel.nodes.find((node) => node.kind === 'variable') },
  play: async ({ canvasElement }) => {
    const canvas = await assertInspectorContainment(canvasElement);
    await expect(canvas.getByRole('heading', { name: longVariable })).toBeVisible();
    await expect(canvas.getByRole('list')).toHaveTextContent(longSection);
  },
};
