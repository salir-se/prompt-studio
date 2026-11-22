/** Live verification states retain automatic findings while the optional AI request changes state. */

import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, fn, userEvent, waitFor, within } from 'storybook/test';
import '../index.css';
import { buildRootCatalog, type CatalogRoot } from '../catalog/root-catalog';
import {
  authoredPromptRootsFromHeads,
  promptDesignProviderKey,
  serializePromptDesign,
} from '../design/prompt-design-project';
import { createWorkspacePrompt } from '../prompt-repo/workspace-document';
import { runRootVerification, VerificationPanel, type VerificationRunResult } from './VerificationPanel';

function scoutRoot(): CatalogRoot {
  const found = buildRootCatalog().find((candidate) => candidate.id === 'scout');
  if (!found) throw new Error('scout root missing from catalog');
  return found;
}

/** A deliberately broken scout doc (required `{{icp_text}}` placeholder removed) so every story's
 *  deterministic `VerificationNode` has non-empty findings to show alongside the semantic layer. */
function brokenScoutResult(): VerificationRunResult {
  const root = scoutRoot();
  const broken = (root.text ?? '').replaceAll('{{icp_text}}', '');
  const result = runRootVerification(root, broken);
  if (!result) throw new TypeError('scout must have a registered verification profile');
  return result;
}

function fakeVerifyResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

function ensureStudioTokenMeta(): void {
  if (document.querySelector('meta[name="studio-token"]')) return;
  const meta = document.createElement('meta');
  meta.setAttribute('name', 'studio-token');
  meta.setAttribute('content', 'storybook-token');
  document.head.appendChild(meta);
}

/** Stubs `window.fetch` for the duration of `run`, restoring the original afterwards — same
 *  try/finally shape `LlmProviderPanel.stories.tsx`'s `OpenRouterModelBrowser` story uses. */
async function withStubbedVerify(response: Response, run: () => Promise<void>): Promise<void> {
  ensureStudioTokenMeta();
  const originalFetch = window.fetch;
  window.fetch = (async () => response) as typeof window.fetch;
  try {
    await run();
  } finally {
    window.fetch = originalFetch;
  }
}

async function clickRunSemanticReview(canvasElement: HTMLElement): Promise<void> {
  const canvas = within(canvasElement);
  const section = brokenScoutResult().sections.find((section) => section.profile.principles.length > 0);
  if (!section) throw new Error('Missing review criteria');
  await userEvent.selectOptions(canvas.getByRole('combobox', { name: 'Verification section' }), section.sectionId);
  await userEvent.click(canvas.getByRole('tab', { name: 'AI review' }));
  await userEvent.click(canvas.getByTestId('semantic-review-run'));
}

const meta: Meta<typeof VerificationPanel> = {
  component: VerificationPanel,
  title: 'Prompts/PromptStudio/VerificationPanel',
  args: { root: scoutRoot(), result: brokenScoutResult(), onClose: fn(), onRecheck: fn() },
  // The panel is a `fixed inset-y-0 right-0` drawer — this backdrop gives the capture a page
  // context to sit in front of, matching how it appears mounted over the studio's canvas.
  decorators: [
    (Story) => (
      <div className="studio relative min-h-[640px] w-full bg-muted/20">
        <div data-studio-panels>
          <Story />
        </div>
      </div>
    ),
  ],
};
export default meta;

type Story = StoryObj<typeof VerificationPanel>;

/** `idle` — deterministic findings render immediately; semantic review has not been requested
 *  yet, so its section shows the opt-in explanation and an enabled "Run semantic review" button. */
export const Idle: Story = {};

/** THE named regression anchor — same as `Idle`, the state every operator sees first. */
export const Default: Story = { args: { ...Idle.args } };

/** Platform-owned section principles and their read-only customization boundaries. */
export const Principles: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const section = brokenScoutResult().sections.find((section) => section.profile.principles.length > 0);
    if (!section) throw new Error('Missing principles');
    await userEvent.selectOptions(canvas.getByRole('combobox', { name: 'Verification section' }), section.sectionId);
    await userEvent.click(canvas.getByRole('tab', { name: 'Checks & criteria' }));
    await waitFor(() => expect(canvas.getByLabelText('Section principles')).toBeInTheDocument());
  },
};

/** `loading` — the button was clicked and the request never resolves (frozen mid-flight), so the
 *  loading message and disabled button are captured mid-review. Deterministic findings unaffected. */
export const Loading: Story = {
  play: async ({ canvasElement }) => {
    ensureStudioTokenMeta();
    const originalFetch = window.fetch;
    window.fetch = (() => new Promise<Response>(() => {})) as typeof window.fetch; // never resolves
    await clickRunSemanticReview(canvasElement);
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByTestId('semantic-review-loading')).toBeInTheDocument());
    window.fetch = originalFetch;
  },
};

/** `results` — a successful 200 with one semantic finding, rendered with its "AI" badge distinct
 *  from the deterministic findings above (sky/amber/destructive chips, no "AI" prefix). */
export const Results: Story = {
  play: async ({ canvasElement }) => {
    await withStubbedVerify(
      fakeVerifyResponse({
        ok: true,
        model: 'claude-sonnet-5',
        findings: [
          {
            source: 'semantic',
            profile: { id: 'scout.candidate-validation.verification', version: 1 },
            principleId: 'evidence-before-persistence',
            severity: 'error',
            message: 'Verification no longer precedes persistence.',
            evidenceQuote: 'save the lead',
            proposedCorrection: 'Verify the source before saving the lead.',
            scope: 'section',
            sectionId: 'scout.candidate-validation',
          },
        ],
      }),
      async () => {
        await clickRunSemanticReview(canvasElement);
        const canvas = within(canvasElement);
        await waitFor(() => expect(canvas.getByTestId('semantic-review-results')).toBeInTheDocument());
      },
    );
  },
};

/** `unavailable` (503) — reads as an informational note (no red, `role="note"`), not an error:
 *  the default state for anyone running the studio without a configured AI provider key. */
export const Unavailable: Story = {
  play: async ({ canvasElement }) => {
    await withStubbedVerify(fakeVerifyResponse({ ok: false, error: 'Verification is unavailable.' }, 503), async () => {
      await clickRunSemanticReview(canvasElement);
      const canvas = within(canvasElement);
      await waitFor(() => expect(canvas.getByTestId('semantic-review-unavailable')).toBeInTheDocument());
    });
  },
};

/** `budget-exhausted` (429) — the session used up its semantic-review budget. */
export const BudgetExhausted: Story = {
  play: async ({ canvasElement }) => {
    await withStubbedVerify(
      fakeVerifyResponse({ ok: false, error: 'Verification budget exhausted for this session.' }, 429),
      async () => {
        await clickRunSemanticReview(canvasElement);
        const canvas = within(canvasElement);
        await waitFor(() => expect(canvas.getByTestId('semantic-review-budget-exhausted')).toBeInTheDocument());
      },
    );
  },
};

/** `failed` (502) — a genuine failure, styled as a destructive alert, distinct from `Unavailable`. */
export const Failed: Story = {
  play: async ({ canvasElement }) => {
    await withStubbedVerify(fakeVerifyResponse({ ok: false, error: 'Verification failed.' }, 502), async () => {
      await clickRunSemanticReview(canvasElement);
      const canvas = within(canvasElement);
      await waitFor(() => expect(canvas.getByTestId('semantic-review-failed')).toBeInTheDocument());
    });
  },
};

export const NeedsRecheck: Story = { args: { result: null } };
export const AutomaticChecksPass: Story = {
  args: { result: runRootVerification(scoutRoot(), scoutRoot().text ?? '') },
};
export const NoProfile: Story = {
  args: {
    root: { ...scoutRoot(), verification: undefined, entry: { ...scoutRoot().entry, editableKeys: [] } },
    result: null,
  },
};

const authored = createWorkspacePrompt({
  id: 'review-example',
  title: 'Evidence review',
  configuration: 'Default',
  tool: '',
  variable: '',
});
const authoredText =
  '## Mission\nSummarize the supplied document.\n## Output\nReturn a concise summary with evidence.\n';
const authoredRoot = authoredPromptRootsFromHeads(
  new Map([
    [authored.design.id, authoredText],
    [promptDesignProviderKey(authored.design.id), serializePromptDesign(authored.design)],
  ]),
).roots[0];

export const GuidedCheckSetup: Story = {
  args: {
    root: authoredRoot,
    text: authoredText,
    result: runRootVerification(authoredRoot, authoredText),
    onSaveDesign: fn(async () => {}),
    onSaveText: fn(async () => {}),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('tab', { name: 'Checks & criteria' }));
    await userEvent.click(canvas.getByRole('button', { name: 'Add automatic check' }));
    await userEvent.selectOptions(canvas.getByRole('combobox', { name: 'Check type' }), 'minimum-length');
    await userEvent.type(canvas.getByRole('spinbutton', { name: 'Minimum characters' }), '40');
  },
};

export const SourceSaveFailure: Story = {
  args: {
    root: authoredRoot,
    text: authoredText,
    result: runRootVerification(authoredRoot, authoredText),
    onSaveText: fn(async () => {
      throw new Error('The project could not be saved. Retry when storage is available.');
    }),
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByRole('textbox', { name: 'Verification prompt source' }), 'Retained repair.');
    await userEvent.click(canvas.getByRole('button', { name: 'Save and recheck' }));
    await waitFor(() =>
      expect(within(canvas.getByRole('region', { name: 'Verification source' })).getByRole('alert')).toHaveTextContent(
        'Your draft is retained',
      ),
    );
  },
};
