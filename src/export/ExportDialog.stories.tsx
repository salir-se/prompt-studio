import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import { ExportDialog } from './ExportDialog';
import { evaluateExportGate } from './export-gate';

const archivePaths = [
  'packages/prompts/src/blueprints/customer-brief/sections/01-mission.md',
  'packages/prompts/src/blueprints/customer-brief/blueprint.json',
  'packages/prompts/src/blueprints/customer-brief/design.json',
  'packages/prompts/src/blueprints/customer-brief/layout.json',
  'packages/prompts/src/blueprints/customer-brief/manifest.json',
  'packages/prompts/src/blueprints/customer-brief/variables/variables.json',
];

const meta = {
  decorators: [
    (Story) => (
      <div className="studio min-h-dvh bg-background text-foreground">
        <Story />
      </div>
    ),
  ],
  component: ExportDialog,
  title: 'Prompts/PromptStudio/ExportDialog',
  args: {
    open: true,
    rootTitle: 'Customer Brief',
    gate: evaluateExportGate({ undeclaredVariables: [], findings: [] }),
    sectionCount: 1,
    variableCount: 0,
    archivePaths,
    onCancel: fn(),
    onExport: fn(),
    onExportProjectArchive: fn(),
  },
} satisfies Meta<typeof ExportDialog>;
export default meta;
type Story = StoryObj<typeof meta>;

/** The file tree stays closed until the designer asks to inspect the archive. */
export const Default: Story = {};

/** The expanded preview exposes prompt Markdown and verification metadata as separate files. */
export const ZipContentsExpanded: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText(`ZIP contents (${archivePaths.length} files)`));
    await expect(canvas.getByRole('list', { name: 'ZIP archive file tree' })).toHaveTextContent('01-mission.md');
    await expect(canvas.getByRole('list', { name: 'ZIP archive file tree' })).toHaveTextContent('design.json');
  },
};

/** The expanded tree and export actions remain usable on the minimum supported viewport. */
export const ZipContentsExpandedMobile: Story = {
  parameters: { viewport: { defaultViewport: 'iphoneSE' } },
  play: ZipContentsExpanded.play,
};
