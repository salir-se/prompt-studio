import '../index.css';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { expect, userEvent, within } from 'storybook/test';
import { EvaluationResults } from './EvaluationResults';
import { EvaluationWorkspace } from './EvaluationWorkspace';
import { RunSettingsForm } from './RunSettingsForm';
import { RunSetupFields } from './RunSetupFields';
import { SingleRun } from './SingleRun';
import type { EvalSuite, Evaluation, RunRecord, RunSettings } from './contracts';
import {
  CAPTURED_EVALUATION,
  CAPTURED_RUN,
  RUN_SETTINGS,
  RUN_SETUP,
  RUN_SOURCE,
  TAG_CANDIDATE,
  TEST_SUITE,
} from './run-fixtures';
import type { EvaluationSession } from './use-evaluation-session';
import type { RunSession } from './use-run-session';

function RunStory({
  captured = false,
  failed = false,
  loading = false,
}: {
  captured?: boolean;
  failed?: boolean;
  loading?: boolean;
}) {
  const [setup, setSetup] = useState(RUN_SETUP);
  const [run, setRun] = useState<RunRecord | null>(
    captured
      ? {
          ...CAPTURED_RUN,
          ...(failed
            ? {
                status: 'failed' as const,
                error: 'The provider rejected this model ID. Choose an available model and run again.',
                output: '',
              }
            : {}),
        }
      : null,
  );
  const session: RunSession = {
    setup,
    setSetup,
    connected: captured,
    projectPending: false,
    settings: { ...RUN_SETTINGS, connected: captured },
    selected: run,
    runs: run ? [run] : [],
    selectedId: run?.runId ?? null,
    setSelectedId: () => {},
    dirty: setup !== RUN_SETUP,
    loading: false,
    busy: false,
    error: null,
    pollError: null,
    running: false,
    load: async () => {},
    run: async () => setRun(CAPTURED_RUN),
    cancel: async () => {},
    saveSettings: async () => true,
    saveProfile: async () => true,
  };
  return (
    <div className="studio flex h-dvh min-h-0 flex-col bg-background text-foreground">
      <header className="border-b p-4">
        <h2 className="font-semibold">Run & evaluate</h2>
        <p className="mt-1 font-mono text-xs text-muted-foreground">prompts/research.md</p>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto scroll-pb-32">
        {loading ? (
          <p role="status" className="p-6">
            Loading run setup and saved results…
          </p>
        ) : (
          <SingleRun session={session} source={RUN_SOURCE} draft onSettings={() => {}} />
        )}
      </div>
    </div>
  );
}
const meta = {
  title: 'Prompts/PromptStudio/Run',
  parameters: { layout: 'fullscreen' },
  render: () => <RunStory />,
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const FirstUse: Story = {};
export const Loading: Story = { render: () => <RunStory loading /> };
export const CapturedOutput: Story = { render: () => <RunStory captured /> };
export const ProviderError: Story = { render: () => <RunStory captured failed /> };
export const Comparison: Story = {
  render: () => (
    <div className="studio min-h-dvh bg-background p-4 text-foreground sm:p-6">
      <div className="mx-auto max-w-5xl">
        <EvaluationResults evaluation={CAPTURED_EVALUATION} busy={false} onCancel={() => {}} />
      </div>
    </div>
  ),
};
export const LongComparison: Story = {
  render: () => (
    <div className="studio min-h-dvh bg-background p-4 text-foreground">
      <EvaluationResults
        evaluation={{
          ...CAPTURED_EVALUATION,
          suite: {
            ...CAPTURED_EVALUATION.suite,
            name: 'Quality expectations for multilingual research with long identifiers and nested project references',
            cases: CAPTURED_EVALUATION.suite.cases.map((test) => ({
              ...test,
              name: 'Deep reference path with an intentionally long name that must wrap on small screens',
              inputs: {
                document_path: 'projects/research/quarterly/evidence/very-long-document-name-without-spaces.md',
              },
            })),
          },
          results: CAPTURED_EVALUATION.results.map((result) => ({
            ...result,
            output: `${result.output}\n\n${'LongUnbrokenOutputValue'.repeat(12)}`,
          })),
        }}
        busy={false}
        onCancel={() => {}}
      />
    </div>
  ),
};
function SettingsStory({ initial = RUN_SETTINGS }: { initial?: RunSettings }) {
  const [settings, setSettings] = useState(initial);
  return (
    <div className="studio min-h-dvh bg-background text-foreground">
      <RunSettingsForm
        settings={settings}
        busy={false}
        onDirtyChange={() => {}}
        onSave={async (value) => {
          setSettings({ ...settings, ...value });
          return true;
        }}
      />
    </div>
  );
}

export const Settings: Story = {
  render: () => <SettingsStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.type(canvas.getByLabelText(/API key/), 'demo-key');
    await userEvent.click(canvas.getByRole('button', { name: 'Save settings & scan skills' }));
    await expect(canvas.getByLabelText(/API key/)).toHaveValue('');
  },
};

export const AdvancedConnectionSettings: Story = {
  ...Settings,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText('Advanced connection settings', { exact: true }));
    await expect(canvas.getByLabelText(/^API base URL/)).toBeVisible();
  },
};

export const CompatibleConnectionSettings: Story = {
  render: () => <SettingsStory initial={{ ...RUN_SETTINGS, provider: 'openai-compat' }} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText(/^API base URL/)).toBeVisible();
  },
};

export const CustomConnectionSettings: Story = {
  render: () => <SettingsStory initial={{ ...RUN_SETTINGS, baseUrl: 'https://gateway.example.test/v1' }} />,
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByLabelText(/^API base URL/)).toBeVisible();
    await expect(within(canvasElement).getByText('Custom endpoint')).toBeVisible();
  },
};

function EvaluationSetupStory({
  compare = false,
  connected = true,
  empty = false,
}: {
  compare?: boolean;
  connected?: boolean;
  empty?: boolean;
}) {
  const [setup, setSetup] = useState(RUN_SETUP);
  const [suite, setSuite] = useState<EvalSuite | null>(empty ? null : TEST_SUITE);
  const [savedSuite, setSavedSuite] = useState<EvalSuite | null>(empty ? null : TEST_SUITE);
  const [evaluations, setEvaluations] = useState<Evaluation[]>([]);
  const session: EvaluationSession = {
    suites: empty ? [] : [TEST_SUITE],
    suite,
    setSuite,
    versions: [TAG_CANDIDATE],
    evaluations,
    selectedId: evaluations[0]?.id ?? null,
    setSelectedId: () => {},
    selected: evaluations[0] ?? null,
    loading: false,
    busy: false,
    error: null,
    pollError: null,
    running: false,
    projectPending: false,
    dirty: JSON.stringify(suite) !== JSON.stringify(savedSuite),
    load: async () => {},
    chooseSuite: () => {},
    createSuite: () => setSuite({ ...TEST_SUITE, id: 'new-suite', name: 'New suite' }),
    saveSuite: async () => setSavedSuite(suite),
    evaluate: async () => setEvaluations([CAPTURED_EVALUATION]),
    cancel: async () => {},
    createTag: async () => true,
    discard: () => setSuite(savedSuite),
  };
  return (
    <div className="studio h-dvh overflow-y-auto scroll-pb-32 bg-background text-foreground">
      <EvaluationWorkspace
        session={session}
        setup={setup}
        runSetup={
          <RunSetupFields
            setup={setup}
            onChange={setSetup}
            settings={RUN_SETTINGS}
            connected={connected}
            onSettings={() => {}}
          />
        }
        source={RUN_SOURCE}
        draft
        compare={compare}
        connected={connected}
        onDirtyChange={() => {}}
      />
    </div>
  );
}
export const SavedTestSuite: Story = {
  render: () => <EvaluationSetupStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByText(/Edit suite/));
    await expect(canvas.getByLabelText('Test name')).toBeVisible();
  },
};
export const ComparisonSetup: Story = { render: () => <EvaluationSetupStory compare /> };

export const NoTestsYet: Story = { render: () => <EvaluationSetupStory compare empty /> };
export const ConnectionRequired: Story = { render: () => <EvaluationSetupStory compare connected={false} /> };

export const SuiteCaseDrafts: Story = {
  render: () => <EvaluationSetupStory />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole('button', { name: 'New suite' }));
    await userEvent.clear(canvas.getByRole('textbox', { name: 'Test name' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'Test name' }), 'First case');
    await userEvent.clear(canvas.getByRole('textbox', { name: 'Test user message' }));
    await userEvent.type(canvas.getByRole('textbox', { name: 'Test user message' }), 'Keep my pending input');
    await userEvent.click(canvas.getByRole('button', { name: 'Add test' }));
    await expect(canvas.getAllByRole('textbox', { name: 'Test name' })).toHaveLength(1);
    await expect(canvas.getByRole('textbox', { name: 'Test name' })).toHaveValue('New test');
    await userEvent.click(canvas.getByRole('button', { name: /First case/ }));
    await expect(canvas.getByRole('textbox', { name: 'Test user message' })).toHaveValue('Keep my pending input');
  },
};
