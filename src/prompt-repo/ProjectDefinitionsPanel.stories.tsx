import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { fn, userEvent, within } from 'storybook/test';
import { ProjectDefinitionsPanel } from './ProjectDefinitionsPanel';
import type { ProjectDefinitions } from './project-definitions';

const definitions: ProjectDefinitions = {
  format: 'prompt-studio-project@1',
  name: 'Account research',
  variables: [
    {
      name: 'company_name',
      purpose: 'The company this prompt should research.',
      sample: 'Example Company',
      required: true,
      lifecycle: 'runtime',
      encoding: 'xml-text',
      presentation: 'placeholder',
    },
  ],
  tools: [
    {
      name: 'lookup_company',
      description: 'Find public company information by name.',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] },
    },
  ],
};
const meta = {
  title: 'Prompts/PromptStudio/ProjectDefinitionsPanel',
  component: ProjectDefinitionsPanel,
  decorators: [
    (Story) => (
      <div className="studio min-h-[720px] bg-muted/20">
        <div data-studio-panels>
          <Story />
        </div>
      </div>
    ),
  ],
  args: {
    definitions,
    kind: 'variables',
    onSave: fn(),
    onClose: fn(),
    references: { company_name: ['Research', 'Outreach'] },
  },
} satisfies Meta<typeof ProjectDefinitionsPanel>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Variables: Story = {};
export const Tools: Story = { args: { kind: 'tools' } };
export const Empty: Story = { args: { definitions: { ...definitions, variables: [] } } };
export const AddVariable: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Add variable' }));
  },
};
export const EditTool: Story = {
  args: { kind: 'tools' },
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Edit lookup_company' }));
  },
};
export const DeleteInUse: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.click(within(canvasElement).getByRole('button', { name: 'Delete company_name' }));
  },
};
export const Saving: Story = {
  args: { onSave: fn(() => new Promise<void>(() => {})) },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Edit company_name' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Save variable' }));
  },
};
export const SaveFailureWithContent: Story = {
  args: {
    onSave: fn(async () => {
      throw new Error('Could not save this project. Your changes are still here; try again.');
    }),
  },
  play: Saving.play,
};
export const ImportConflict: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.upload(
      canvas.getByLabelText('Upload variables JSON'),
      new File(
        [
          JSON.stringify({
            format: 'prompt-studio-variables@1',
            variables: [{ ...definitions.variables[0], purpose: 'Imported description' }],
          }),
        ],
        'variables.json',
        { type: 'application/json' },
      ),
    );
  },
};
export const InvalidImportWithContent: Story = {
  play: async ({ canvasElement }) => {
    await userEvent.upload(
      within(canvasElement).getByLabelText('Upload variables JSON'),
      new File(['not json'], 'variables.json', { type: 'application/json' }),
    );
  },
};
export const LongContent: Story = {
  args: {
    definitions: {
      ...definitions,
      tools: [
        {
          ...definitions.tools[0],
          name: 'lookup_company_information_for_all_registered_business_locations',
          description:
            'Find each business location and its publicly available contact information. Review the results before using them in an outreach prompt.',
        },
      ],
    },
    kind: 'tools',
  },
};
