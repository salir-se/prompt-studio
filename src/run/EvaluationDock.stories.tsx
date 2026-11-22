import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { expect, userEvent, waitFor, within } from 'storybook/test';
import { StudioPanelFocus } from '../components/StudioPanelFocus';
import { usePanelState } from '../hooks/use-panel-state';
import { useStudioShortcuts } from '../hooks/use-studio-shortcuts';
import { ShortcutControl } from '../shortcuts/ShortcutControl';
import { ShortcutEducation } from '../shortcuts/ShortcutEducation';
import { RunWorkspace } from './RunWorkspace';
import { CAPTURED_EVALUATION, RUN_SETTINGS, RUN_SETUP, RUN_SOURCE, TAG_CANDIDATE, TEST_SUITE } from './run-fixtures';

function EvaluationDockStory() {
  const panels = usePanelState();
  useStudioShortcuts({ enabled: true, explorer: () => {}, changeView: () => true, verify: () => {} });
  return (
    <ShortcutEducation>
      <div className="studio flex h-dvh min-h-0 flex-col bg-background text-foreground">
        <section inert={panels.modal} aria-label="Writing workspace" className="min-h-0 flex-1 overflow-y-auto p-6">
          <h1 className="text-xl font-semibold">Research brief</h1>
          <p className="mt-2 text-sm text-muted-foreground">Keep writing while reviewing saved test outputs below.</p>
          <ShortcutControl id="evaluations">
            <button
              type="button"
              className="mt-3 rounded-md border px-3 py-2 text-sm"
              onClick={() => panels.toggleEvaluations()}
            >
              Toggle evaluations
            </button>
          </ShortcutControl>
          <label className="mt-5 grid gap-2 text-sm">
            Prompt source
            <textarea className="min-h-24 rounded-md border p-3 font-mono text-xs" defaultValue={RUN_SOURCE} />
          </label>
        </section>
        <StudioPanelFocus modal={panels.modal}>
          {panels.retainedEvaluation && (
            <RunWorkspace
              dock
              hidden={panels.activePanel !== 'evaluate'}
              project={{ projectId: 'dock-story', revision: 3 }}
              promptPath="prompts/research.md"
              source={RUN_SOURCE}
              draft={false}
              onDirtyChange={panels.onDirtyChange}
              onClose={() => panels.dismissPanel()}
            />
          )}
        </StudioPanelFocus>
      </div>
    </ShortcutEducation>
  );
}
const meta = {
  title: 'Prompts/PromptStudio/EvaluationDock',
  parameters: { layout: 'fullscreen' },
  render: () => <EvaluationDockStory />,
  beforeEach: () => {
    const original = globalThis.fetch;
    globalThis.fetch = async (input, init) => {
      const path = String(input);
      if (!path.includes('/__studio/run')) return original(input, init);
      if (init?.method === 'POST') {
        if (path.endsWith('/evaluations')) return Response.json({ evaluation: CAPTURED_EVALUATION });
        if (path.endsWith('/suites')) return Response.json({ suite: JSON.parse(String(init.body ?? '{}')).suite });
        return Response.json({ ok: true });
      }
      if (path.endsWith('/settings')) return Response.json(RUN_SETTINGS);
      if (path.includes('/profile?')) return Response.json({ profile: RUN_SETUP });
      if (path.includes('/suites?')) return Response.json({ suites: [TEST_SUITE] });
      if (path.includes('/versions?')) return Response.json({ versions: [TAG_CANDIDATE] });
      if (path.includes('/evaluations?')) return Response.json({ evaluations: [CAPTURED_EVALUATION] });
      return Response.json({ runs: [] });
    };
    return () => {
      globalThis.fetch = original;
    };
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const DockedTests: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Toggle evaluations' }));
    await expect(await canvas.findByRole('button', { name: 'Run test suite' })).toBeVisible();
    await expect(canvas.getByRole('tab', { name: 'Test suites' })).toHaveAttribute('aria-selected', 'true');
    if (window.matchMedia('(max-width: 767px)').matches) {
      await waitFor(() => {
        const tip = document.querySelector('[aria-label="Shortcut tip"]')?.closest('[data-sonner-toast]');
        if (!tip) return;
        const tipBox = tip.getBoundingClientRect();
        const action = canvas.getByRole('button', { name: 'Run test suite' }).getBoundingClientRect();
        const overlaps =
          tipBox.left < action.right &&
          tipBox.right > action.left &&
          tipBox.top < action.bottom &&
          tipBox.bottom > action.top;
        expect(overlaps).toBe(false);
      });
    }
  },
};
export const ExpandedCompare: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Toggle evaluations' }));
    await userEvent.click(await canvas.findByRole('tab', { name: 'Compare' }));
    if (window.matchMedia('(min-width: 768px)').matches) {
      await userEvent.click(canvas.getByRole('button', { name: 'Expand evaluations' }));
    }
    await expect(await canvas.findByRole('button', { name: 'Run comparison' })).toBeVisible();
  },
};
export const MinimizedWithDraft: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Toggle evaluations' }));
    await userEvent.click(await canvas.findByRole('tab', { name: 'Compare' }));
    const rubric = await canvas.findByRole('textbox', { name: 'Judging rubric' });
    await userEvent.clear(rubric);
    await userEvent.type(rubric, 'Preserve this unfinished criterion.');
    if (window.matchMedia('(min-width: 768px)').matches) {
      await userEvent.click(canvas.getByRole('button', { name: 'Minimize evaluations' }));
      await expect(canvas.getByRole('button', { name: 'Restore evaluations' })).toBeVisible();
    }
  },
};

export const HiddenDraftRestored: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Toggle evaluations' }));
    await userEvent.click(await canvas.findByRole('button', { name: 'New suite' }));
    const suite = canvas.getByRole('textbox', { name: 'Suite name' });
    await userEvent.clear(suite);
    await userEvent.type(suite, 'Preserve this unfinished suite');
    await userEvent.keyboard('{Alt>}5{/Alt}');
    await expect(canvas.queryByRole('heading', { name: 'Evaluations' })).not.toBeInTheDocument();
    await userEvent.keyboard('{Alt>}5{/Alt}');
    await expect(canvas.getByRole('textbox', { name: 'Suite name' })).toHaveValue('Preserve this unfinished suite');
  },
};
export const SharedSettings: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'Toggle evaluations' }));
    await userEvent.click(await canvas.findByRole('tab', { name: 'Settings' }));
    await expect(canvas.getByRole('heading', { name: 'Shared execution settings' })).toBeVisible();
    await expect(canvas.getByRole('button', { name: 'Open app settings' })).toBeVisible();
  },
};
