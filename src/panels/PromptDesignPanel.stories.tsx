import { createBlankPromptDesign, parsePromptDesign } from '@prompt-studio/prompts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn } from 'storybook/test';
import '../index.css';
import { PromptDesignPanel } from './PromptDesignPanel';

const blank = createBlankPromptDesign({ id: 'account-research', title: 'Account Research' });
const structured = parsePromptDesign(
  JSON.stringify({
    ...blank.design,
    version: 2,
    input: {
      kind: 'json',
      description: 'Account research request.',
      jsonSchema: { type: 'object', required: ['company'], properties: { company: { type: 'string' } } },
      examples: [{ company: 'Acme' }],
    },
    output: {
      kind: 'json',
      description: 'Verified account summary.',
      jsonSchema: { type: 'object', required: ['summary'], properties: { summary: { type: 'string' } } },
      examples: [{ summary: 'Acme is hiring.' }],
    },
  }),
);

const meta = {
  component: PromptDesignPanel,
  title: 'Prompts/PromptStudio/PromptDesignPanel',
  args: { design: blank.design, text: blank.text, onSave: fn(), onClose: fn() },
  decorators: [
    (Story) => (
      <div className="studio min-h-[720px] bg-muted/20">
        <div data-studio-panels>
          <Story />
        </div>
      </div>
    ),
  ],
} satisfies Meta<typeof PromptDesignPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

export const FreeText: Story = {};
export const StructuredJson: Story = { args: { design: structured } };
/** A real schema violation remains visible for visual and instructional review. */
export const StructuredJsonSchemaViolation: Story = {
  args: { design: structured },
  play: async ({ canvas, userEvent }) => {
    await userEvent.type(canvas.getByLabelText('JSON sample to verify'), '{}');
    await userEvent.click(canvas.getByRole('button', { name: 'Verify sample' }));
    await expect(canvas.getByRole('status')).toHaveTextContent('required');
  },
};
/** The focused contract editor remains usable in its narrowest supported drawer layout. */
export const StructuredJsonMobile: Story = {
  args: { design: structured },
  parameters: { viewport: { defaultViewport: 'iphoneSE' } },
};
export const InvalidStructuredExample: Story = {
  args: {
    design: parsePromptDesign(
      JSON.stringify({
        ...structured,
        output: { ...structured.output, examples: [{}] },
      }),
    ),
  },
};
export const MajorWorkflow: Story = {
  args: {
    design: parsePromptDesign(
      JSON.stringify({
        ...blank.design,
        tools: ['search_accounts', 'save_account'],
        workflow: `sequenceDiagram
  User->>Prompt: Submit account
  Prompt->>Search: Find evidence
  Search-->>Prompt: Evidence
  Prompt->>Storage: Save verified account
  Prompt-->>User: Confirmation`,
        output: { kind: 'tool-call', description: 'Finish by saving the account.', requiredToolName: 'save_account' },
      }),
    ),
  },
};

export const SectionDesign: Story = {
  args: {
    sectionId: 'account-research.mission',
    design: parsePromptDesign(
      JSON.stringify({
        ...blank.design,
        sectionDesigns: [
          {
            sectionId: 'account-research.mission',
            input: { kind: 'free-text', description: 'Research goal and available context.' },
            workflow: `stateDiagram-v2
  [*] --> UnderstandRequest
  UnderstandRequest --> Research
  Research --> Verify
  Verify --> [*]`,
            output: { kind: 'freeform', description: 'Evidence-backed research instructions.' },
          },
        ],
      }),
    ),
  },
};

export const InvalidWorkflow: Story = {
  args: {
    design: parsePromptDesign(
      JSON.stringify({
        ...blank.design,
        workflow: 'flowchart LR\n  Input -->',
      }),
    ),
  },
};

/** Invalid text stays editable and cannot be mistaken for a saved schema. */
export const InvalidVisibleSchema: Story = {
  args: { design: structured },
  play: async ({ canvas, userEvent }) => {
    const schema = canvas.getByLabelText('Input JSON schema');
    await userEvent.clear(schema);
    await userEvent.type(schema, '{{"type":');
    await expect(schema).toHaveValue('{"type":');
    await expect(canvas.getByRole('alert')).toHaveTextContent('Enter a valid JSON object before saving.');
    await expect(canvas.getByRole('button', { name: 'Save prompt design' })).toBeDisabled();
    canvas.getByRole('alert').scrollIntoView({ block: 'center' });
  },
};
