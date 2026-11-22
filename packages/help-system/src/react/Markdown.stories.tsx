// Plain CSF3 — no `@storybook/react-vite` import so the package's typecheck stays
// dependency-free (Storybook types are wired by the host app, not this package).
import type { ReactNode } from 'react';
import { Markdown } from './Markdown';

const meta = {
  title: 'Help/Markdown',
  component: Markdown,
  tags: ['layout-inspector', 'test-ready'],
  parameters: { layout: 'fullscreen', layoutInspector: { test: 'error' } },
  decorators: [
    // Mimic the help panel: a narrow, light surface so table overflow/wrapping is visible.
    (Story: () => ReactNode) => (
      <div style={{ maxWidth: 360, padding: 16, border: '1px solid rgba(0,0,0,0.1)', borderRadius: 8, fontSize: 14 }}>
        <Story />
      </div>
    ),
  ],
};
export default meta;

// The "Logs" help answer — a GFM table now renders as a real table, not raw pipes.
export const WithTable = {
  args: {
    text: [
      "Here's what you'll see there:",
      '',
      '| Area | What it does |',
      '|------|--------------|',
      '| **Filter toolbar** | narrow by Type (All / Agent Runs / Actions) and Status |',
      '| **Pagination** | 25 entries per page, hard-capped at 100 |',
      '| **Run Log entries** | status icon, token count, duration, and each tool call |',
      '| **Header actions** | `Export Logs`, `Import Logs`, `Clear` |',
      '',
      'Expand a run to view the **Final Result**, any error alert, and the iteration accordion.',
    ].join('\n'),
  },
};

// A wider table scrolls horizontally inside the panel instead of pushing it sideways.
export const WideTable = {
  args: {
    text: [
      '| Provider | Model | Context | Input $/1M | Output $/1M |',
      '|---|---|--:|--:|--:|',
      '| Anthropic | claude-opus-4-8 | 1M | $5.00 | $25.00 |',
      '| Anthropic | claude-sonnet-5 | 1M | $3.00 | $15.00 |',
      '| z.ai | glm-4.6 | 200K | $0.60 | $2.20 |',
    ].join('\n'),
  },
};

// The prompt studio's final-prompt preview case that motivated the `<ol start>` fix: explicit
// 1./2./3. steps, a prose line, then 4./5. — each group used to restart its `<ol>` at 1; the
// second list now carries `start={4}` from the source's own numbering.
export const SplitOrderedList = {
  args: {
    text: [
      '1. Open the Outreach tab',
      '2. Select the draft',
      '3. Click Approve',
      '',
      'Once approved, wrap up:',
      '',
      '4. Confirm the send window',
      '5. Publish the order',
    ].join('\n'),
  },
};

// Mixed content — headings, list, inline code, and a table together.
export const MixedContent = {
  args: {
    text: [
      '## Email finding',
      '',
      'I used `guess_email`, then `verify_email`:',
      '',
      '| Pattern | Candidate | Valid |',
      '|---|---|:-:|',
      '| first.last | `magnus.wideberg@mynt.se` | ✅ |',
      '| first | `magnus@mynt.se` | ✅ |',
      '',
      '- ✅ Format is correct',
      '- ❌ Not SMTP-tested',
    ].join('\n'),
  },
};
