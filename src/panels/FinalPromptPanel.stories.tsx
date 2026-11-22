import '../index.css';
import { createBlankPromptDesign, parsePromptDesign } from '@prompt-studio/prompts';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, within } from 'storybook/test';
import {
  authoredPromptRootsFromHeads,
  promptDesignProviderKey,
  serializePromptDesign,
} from '../design/prompt-design-project';
import { FinalPromptPanel } from './FinalPromptPanel';

const markdown = `# Customer Brief

## Mission

<mission>
Turn a customer request into a concise, evidence-based brief.

1. Call fetch_customer for trusted context.
2. Do not invent missing facts.
3. Return only JSON with summary and priority.
</mission>
`;

const blank = createBlankPromptDesign({ id: 'customer-brief', title: 'Customer Brief' });
const design = parsePromptDesign(
  JSON.stringify({
    ...blank.design,
    tools: ['fetch_customer'],
    workflow: 'flowchart LR\n  Request --> Mission --> Validate --> JSON',
    output: {
      kind: 'json',
      description: 'A concise customer brief with an explicit priority.',
      jsonSchema: {
        type: 'object',
        additionalProperties: false,
        required: ['summary', 'priority'],
        properties: {
          summary: { type: 'string' },
          priority: { type: 'string', enum: ['low', 'medium', 'high'] },
        },
      },
      examples: [{ summary: 'Expansion opportunity', priority: 'high' }],
    },
  }),
);
const root = authoredPromptRootsFromHeads(
  new Map([
    ['customer-brief', markdown],
    [promptDesignProviderKey('customer-brief'), serializePromptDesign(design)],
  ]),
).roots[0];
if (!root) throw new Error('Customer Brief story root is invalid.');

const meta = {
  component: FinalPromptPanel,
  title: 'Prompts/PromptStudio/FinalPromptPanel',
  args: { root, text: markdown, onClose: fn() },
  decorators: [
    (Story) => (
      <div className="studio min-h-[720px] w-full bg-muted/20">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof FinalPromptPanel>;
export default meta;
type Story = StoryObj<typeof meta>;

/** Resolved developer preview with the prompt-versus-verification boundary visible. */
export const Default: Story = {};

/** Canonical Markdown is shown byte-for-byte while the design sidecar remains clearly separate. */
export const MarkdownSource: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Source Markdown' }));
    await expect(canvas.getByTestId('final-prompt-raw')).toHaveTextContent('Return only JSON');
  },
};

/** The source and sidecar explanation remains readable at the narrowest supported viewport. */
export const MarkdownSourceMobile: Story = {
  parameters: { viewport: { defaultViewport: 'iphoneSE' } },
  play: MarkdownSource.play,
};

/** Completed, read-only AI compact interpretation with before/after token estimates. */
export const CompactInterpretation: Story = {
  beforeEach: () => {
    const token = document.createElement('meta');
    token.name = 'studio-token';
    token.content = 'storybook-token';
    document.head.appendChild(token);
    const previousFetch = globalThis.fetch;
    globalThis.fetch = async () =>
      ({
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          compactText:
            'Turn the customer request into an evidence-based brief. Call fetch_customer, never invent facts, and return only JSON containing summary and priority.',
          model: 'glm-5.3',
        }),
      }) as Response;
    return () => {
      token.remove();
      globalThis.fetch = previousFetch;
    };
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Run compact check' }));
    await expect(canvas.getByTestId('compact-interpretation-result')).toBeVisible();
  },
};

/** Shared variable samples affect the preview, never the canonical source. */
export const CanonicalSourceWithSamples: Story = {
  args: {
    text: 'Research {{company}} using fetch_customer.',
    previewText: 'Research Acme using fetch_customer.',
  },
  play: async ({ canvas }) => {
    await userEvent.click(canvas.getByTestId('final-prompt-source-toggle'));
    await expect(canvas.getByTestId('final-prompt-raw')).toHaveTextContent(
      'Research {{company}} using fetch_customer.',
    );
  },
};
