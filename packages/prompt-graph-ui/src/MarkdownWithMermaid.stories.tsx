/** The shared Markdown renderer handles prose, Pele diagrams, and invalid-fence fallback. */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, waitFor, within } from 'storybook/test';
import { MarkdownWithMermaid } from './MarkdownWithMermaid';

const meta: Meta<typeof MarkdownWithMermaid> = {
  component: MarkdownWithMermaid,
  title: 'Prompts/PromptGraphUi/MarkdownWithMermaid',
  decorators: [
    (Story) => (
      <div className="max-w-[720px] bg-background p-4 text-sm">
        <Story />
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof MarkdownWithMermaid>;

const MIXED_DOCUMENT = `## Prompt composition pipeline

Sections are **markdown source of truth**; the graph is a projection (ADR-202).

\`\`\`mermaid
flowchart LR
  md[sections/*.md] -->|parse| bp[PromptBlueprint]
  bp -->|project| proj{{"nodes + edges"}}
  proj -->|render| canvas[Canvas]
  canvas -->|"graph action = text edit"| md
\`\`\`

The same document can mix diagram types — a sequence diagram of a Scout run:

\`\`\`mermaid
sequenceDiagram
  participant S as Scout
  participant W as web_search
  participant L as save_lead
  S->>W: query job boards
  W-->>S: signals
  S->>L: save scored signal
\`\`\`

And ordinary markdown keeps rendering *between* and *after* fences.
`;

/** The headline demo: prose + a flowchart + a sequence diagram in ONE document, all rendered. */
export const MixedDocument: Story = {
  args: { text: MIXED_DOCUMENT },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(
      async () => {
        const diagrams = await canvas.findAllByTestId('mermaid-diagram');
        await expect(diagrams).toHaveLength(2);
        for (const diagram of diagrams) {
          await expect(diagram.querySelector('img')?.naturalWidth).toBeGreaterThan(0);
        }
      },
      { timeout: 10_000 },
    );
  },
};

/** Named regression anchor — same args as `MixedDocument` (see `FragmentNode.stories.tsx`'s
 *  `Default` convention). */
export const Default: Story = {
  args: { text: MIXED_DOCUMENT },
  play: MixedDocument.play,
};

/** An invalid fence renders the visible error fallback (message + the raw code), never a crash —
 *  and the VALID fence in the same document still renders. */
export const InvalidDiagramFallback: Story = {
  args: {
    text: `Valid diagram first:

\`\`\`mermaid
flowchart TD
  a[ok] --> b[still ok]
\`\`\`

Broken fence second:

\`\`\`mermaid
flowchart TD
  a[unclosed --> ???
\`\`\`
`,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(
      async () => {
        await expect(await canvas.findByTestId('mermaid-error')).toBeVisible();
        const diagram = await canvas.findByRole('img', { name: 'Mermaid diagram' });
        await expect((diagram as HTMLImageElement).naturalWidth).toBeGreaterThan(0);
      },
      { timeout: 10_000 },
    );
  },
};

/** No fences at all — the document passes straight through the shared `Markdown` renderer. */
export const PlainMarkdownOnly: Story = {
  args: { text: '## Just markdown\n\nNo mermaid fences here — **nothing** to upgrade.' },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.queryByTestId('mermaid-diagram')).toBeNull();
    await expect(canvas.queryByTestId('mermaid-loading')).toBeNull();
  },
};
