import { Button } from '@prompt-studio/ui/button';
import { Input } from '@prompt-studio/ui/input';
import { Label } from '@prompt-studio/ui/label';
import { Textarea } from '@prompt-studio/ui/textarea';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import type { StudioMcpServer } from '../mcp/contracts';
import { ShortcutControl } from '../shortcuts/ShortcutControl';
import { EvaluationResults } from './EvaluationResults';
import { RUN_FIELD } from './RunFields';
import { SuiteEditor } from './SuiteEditor';
import type { PromptCandidate, RunSetup } from './contracts';
import type { EvaluationSession } from './use-evaluation-session';

export function EvaluationWorkspace({
  session,
  setup,
  source,
  draft,
  compare,
  connected,
  onDirtyChange,
  runSetup,
  onBeforeEvaluate,
  mcpServers,
}: {
  session: EvaluationSession;
  setup: RunSetup;
  mcpServers?: StudioMcpServer[];
  source: string;
  draft: boolean;
  compare: boolean;
  connected: boolean;
  onDirtyChange: (dirty: boolean) => void;
  runSetup?: ReactNode;
  onBeforeEvaluate?: () => Promise<boolean>;
}) {
  const results = useRef<HTMLElement>(null);
  const previous = session.evaluations.find((evaluation) => evaluation.candidates.length === 2);
  const available = (id: string | undefined) =>
    id === 'working' || session.versions.some((version) => version.id === id);
  const [baselineId, setBaselineId] = useState(
    available(previous?.candidates[0]?.id) ? previous!.candidates[0].id : '',
  );
  const [candidateId, setCandidateId] = useState(
    available(previous?.candidates[1]?.id) ? previous!.candidates[1].id : 'working',
  );
  const previousJudge = session.evaluations.find((evaluation) => evaluation.judge)?.judge;
  const [judge, setJudge] = useState(Boolean(previousJudge));
  const [judgeModel, setJudgeModel] = useState(previousJudge?.model ?? '');
  const [rubric, setRubric] = useState(previousJudge?.rubric ?? '');
  const [tagName, setTagName] = useState('');
  const [message, setMessage] = useState('');
  const current: PromptCandidate = { id: 'working', label: draft ? 'Current draft' : 'Current prompt', source };
  const candidates = [current, ...session.versions];
  const baseline = candidates.find((entry) => entry.id === (baselineId || session.versions[0]?.id || 'working'));
  const candidate = candidates.find((entry) => entry.id === candidateId);
  const validComparison = Boolean(baseline && candidate && baseline.id !== candidate.id);
  const savedRubric = session.evaluations.some(
    (evaluation) => evaluation.judge?.rubric === rubric.trim() && evaluation.judge?.model === judgeModel.trim(),
  );
  useEffect(() => {
    onDirtyChange(Boolean(tagName.trim()) || (Boolean(rubric || judgeModel) && !savedRubric));
  }, [tagName, rubric, judgeModel, savedRubric, onDirtyChange]);
  const blockedReason = session.projectPending
    ? 'Wait for project changes to save.'
    : !session.suite
      ? 'Choose or create a test suite.'
      : !session.suite.cases.length
        ? 'Add at least one test to this suite.'
        : session.dirty
          ? 'Save suite edits before evaluating.'
          : !connected
            ? 'Connect this provider in Settings to run.'
            : !setup.model.trim()
              ? 'Enter a model to run these tests.'
              : compare && !validComparison
                ? 'Choose two different prompt versions.'
                : compare && judge && (!judgeModel.trim() || !rubric.trim())
                  ? 'Enter a judge model and rubric, or turn judging off.'
                  : '';
  const actionLabel = session.running ? 'Evaluation running…' : compare ? 'Run comparison' : 'Run test suite';
  const canRun = !blockedReason && !session.busy && !session.running;
  async function evaluate() {
    if (!canRun || (onBeforeEvaluate && !(await onBeforeEvaluate()))) return;
    await session.evaluate(
      compare && baseline && candidate ? [baseline, candidate] : [current],
      setup,
      compare && judge ? { model: judgeModel.trim(), rubric: rubric.trim() } : undefined,
    );
  }
  async function createTag() {
    setMessage('');
    if (await session.createTag(tagName.trim())) {
      setMessage(`Git tag “${tagName.trim()}” created for the saved project.`);
      setTagName('');
    }
  }
  return (
    <section
      aria-label={compare ? 'Compare prompt versions' : 'Evaluate prompt'}
      className="flex min-h-full flex-col"
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key === 'Enter' &&
          !event.nativeEvent.isComposing &&
          !event.defaultPrevented &&
          !event.altKey &&
          !event.shiftKey
        ) {
          const overlay =
            event.target instanceof Element ? event.target.closest('[role="dialog"], [role="menu"]') : null;
          if (overlay && !overlay.hasAttribute('data-studio-panels')) return;
          event.preventDefault();
          event.stopPropagation();
          void evaluate();
        }
      }}
    >
      <div className="grid min-w-0 flex-1 lg:grid-cols-[minmax(280px,0.8fr)_minmax(0,1.3fr)]">
        <div className="grid min-w-0 content-start gap-5 border-b p-4 sm:p-6 lg:border-r lg:border-b-0">
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {compare ? 'Matched experiment' : 'Test suite'}
            </p>
            <h3 className="text-lg font-semibold tracking-tight">
              {compare ? 'Compare prompt versions' : 'Reusable test cases'}
            </h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {compare
                ? 'Run the same saved cases against two prompt versions. Git tags identify immutable saved versions.'
                : 'Build a suite once, then run every case against the current prompt.'}
            </p>
          </div>
          <SuiteEditor session={session} source={source} servers={mcpServers} defaultTools={setup.tools} />
          <div className="space-y-2">
            <h4 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Current execution setup
            </h4>
            {runSetup}
          </div>
          {compare && (
            <fieldset className="grid min-w-0 gap-3 rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">Versions to compare</legend>
              <Label className="grid min-w-0 gap-1 text-sm">
                A · Baseline
                <select
                  className={RUN_FIELD}
                  value={baseline?.id ?? ''}
                  onChange={(event) => setBaselineId(event.target.value)}
                >
                  {candidates.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </Label>
              <Label className="grid min-w-0 gap-1 text-sm">
                B · Candidate
                <select
                  className={RUN_FIELD}
                  value={candidateId}
                  onChange={(event) => setCandidateId(event.target.value)}
                >
                  {candidates.map((entry) => (
                    <option key={entry.id} value={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              </Label>
              {!validComparison && (
                <p className="text-xs text-muted-foreground">
                  Choose two different versions. Create a Git tag below if this is your first saved version.
                </p>
              )}
              <details>
                <summary className="cursor-pointer text-sm">Save a Git version tag</summary>
                <div className="mt-3 grid gap-3">
                  <Label className="grid gap-1 text-sm">
                    New Git tag
                    <Input
                      value={tagName}
                      onChange={(event) => setTagName(event.target.value)}
                      placeholder="prompt-v1"
                    />
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    The tag captures the entire saved project, including prompt files and references. Tags cannot be
                    overwritten. A project checkpoint saves your work; a Git tag also makes that saved state selectable
                    here.
                  </p>
                  {draft && <p className="text-xs">Apply the writing draft to the project before creating a tag.</p>}
                  <Button
                    type="button"
                    variant="outline"
                    disabled={draft || session.projectPending || session.busy || !tagName.trim()}
                    onClick={() => void createTag()}
                  >
                    Create Git tag
                  </Button>
                  {message && (
                    <p className="text-xs" role="status">
                      {message}
                    </p>
                  )}
                </div>
              </details>
            </fieldset>
          )}
          {compare && (
            <fieldset className="grid min-w-0 gap-3 rounded-lg border p-4">
              <legend className="px-1 text-sm font-medium">Optional LLM judge</legend>
              <Label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="size-4 accent-primary"
                  checked={judge}
                  onChange={(event) => setJudge(event.target.checked)}
                />
                Judge both answers
              </Label>
              {judge && (
                <>
                  <Label className="grid gap-1 text-sm">
                    Judge model
                    <Input
                      value={judgeModel}
                      onChange={(event) => setJudgeModel(event.target.value)}
                      placeholder="Model ID from the same provider"
                    />
                  </Label>
                  <Label className="grid gap-1 text-sm">
                    Judging rubric
                    <Textarea
                      rows={4}
                      value={rubric}
                      onChange={(event) => setRubric(event.target.value)}
                      placeholder="Compare factual accuracy, completeness and adherence to the expected answer…"
                    />
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Adds one model request per test. The rubric, model and verdict are retained with the evaluation.
                    Automatic checks remain separate.
                  </p>
                </>
              )}
            </fieldset>
          )}
        </div>
        <section
          ref={results}
          tabIndex={-1}
          aria-label="Saved evaluation results and outputs"
          className="grid min-w-0 content-start gap-4 p-4 sm:p-6"
        >
          <Label className="grid min-w-0 gap-1.5 text-sm">
            Saved evaluation results
            <select
              className={RUN_FIELD}
              value={session.selectedId ?? ''}
              onChange={(event) => session.setSelectedId(event.target.value)}
              disabled={session.evaluations.length === 0}
            >
              {session.evaluations.length === 0 && <option value="">No evaluations yet</option>}
              {session.evaluations.map((evaluation) => (
                <option key={evaluation.id} value={evaluation.id}>
                  {new Date(evaluation.startedAt).toLocaleString()} · {evaluation.suite.name} · {evaluation.status}
                </option>
              ))}
            </select>
          </Label>
          {session.selected ? (
            <EvaluationResults
              evaluation={session.selected}
              busy={session.busy}
              onCancel={() => void session.cancel(session.selected!.id)}
            />
          ) : (
            <div className="grid min-h-64 place-content-center rounded-xl border border-dashed p-8 text-center">
              <h3 className="font-semibold">Results you can return to</h3>
              <p className="mt-2 max-w-sm text-sm text-muted-foreground">
                Save a suite and run it. Per-case outputs, automatic checks and version sources are kept locally for
                review.
              </p>
            </div>
          )}
        </section>
      </div>
      <section
        className="sticky bottom-0 z-10 grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-2 sm:flex sm:flex-wrap border-t bg-background px-4 py-3 shadow-[0_-4px_12px_0_rgb(0_0_0/0.04)] sm:px-6"
        aria-label="Evaluation actions"
      >
        <div className="col-span-2 min-w-0 flex-1 text-xs text-muted-foreground" role="status">
          {blockedReason ||
            `${session.suite?.cases.length ?? 0} tests · ${(session.suite?.cases.length ?? 0) * (compare ? 2 + Number(judge) : 1)} model runs${session.running ? ' · Evaluation in progress' : ' · Provider charges may apply'}`}
        </div>
        {session.selected && (
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              results.current?.focus();
              results.current?.scrollIntoView({ block: 'start' });
            }}
          >
            View results
          </Button>
        )}
        <ShortcutControl id={compare ? 'runComparison' : 'runTests'}>
          <Button
            type="button"
            className="col-start-2 justify-self-end"
            aria-label={actionLabel}
            aria-keyshortcuts="Control+Enter Meta+Enter"
            disabled={!canRun}
            onClick={() => void evaluate()}
          >
            {actionLabel}
            <kbd className="ml-2 text-[10px] opacity-70">⌘/Ctrl ↵</kbd>
          </Button>
        </ShortcutControl>
      </section>
    </section>
  );
}
