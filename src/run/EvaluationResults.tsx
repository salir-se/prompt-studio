import { Badge } from '@prompt-studio/ui/badge';
import { Button } from '@prompt-studio/ui/button';
import { useState } from 'react';
import { ToolCallHistory } from '../mcp/ToolCallHistory';
import type { Evaluation } from './contracts';
import { downloadRun } from './run-client';

export function EvaluationResults({
  evaluation,
  busy,
  onCancel,
}: {
  evaluation: Evaluation;
  busy: boolean;
  onCancel: () => void;
}) {
  const [filter, setFilter] = useState<'all' | 'attention'>('all');
  const completed = evaluation.results.length;
  const total = evaluation.suite.cases.length * evaluation.candidates.length;
  const counts = { passed: 0, failed: 0, error: 0, unscored: 0 };
  for (const result of evaluation.results) counts[result.status]++;
  const attention = evaluation.suite.cases.filter((test) => {
    const results = evaluation.results.filter((result) => result.caseId === test.id);
    return (
      results.some((result) => result.status === 'failed' || result.status === 'error') ||
      evaluation.judge?.results.some((result) => result.caseId === test.id && result.verdict === 'error') ||
      (evaluation.status !== 'running' && results.length < evaluation.candidates.length)
    );
  });
  const cases = filter === 'attention' ? attention : evaluation.suite.cases;
  return (
    <article className="grid min-w-0 content-start gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Captured evaluation</p>
          <h3 className="text-lg font-semibold tracking-tight">{evaluation.suite.name}</h3>
          <p className="break-all text-xs text-muted-foreground">
            {new Date(evaluation.startedAt).toLocaleString()} · {evaluation.setup.provider} / {evaluation.setup.model}
          </p>
        </div>
        <span role="status" className="rounded-full border px-2 py-1 text-xs capitalize">
          {evaluation.status} · {completed}/{total} outputs
        </span>
      </div>
      {evaluation.status === 'running' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-3 text-sm">
          <span>Results are saved as each test finishes.</span>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Cancel evaluation
          </Button>
        </div>
      )}
      {evaluation.error && (
        <p role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-destructive">
          {evaluation.error}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {evaluation.candidates.length > 1
          ? 'Both versions use the same test cases, model, skills and current project files.'
          : 'Each test uses the captured prompt version, model and skill attachments.'}{' '}
        A passed check confirms only the configured rule; model outputs can vary between runs.
      </p>
      <section aria-label="Evaluation summary" className="grid gap-3 rounded-lg border bg-muted/20 p-3">
        <p className="text-xs font-medium text-muted-foreground">
          Automatic output checks · {evaluation.suite.cases.length} tests · {total} outputs
        </p>
        <div className="flex flex-wrap gap-2">
          <Badge variant="outline">{counts.passed} passed</Badge>
          <Badge variant="outline">{counts.failed} failed</Badge>
          <Badge variant="outline">
            {counts.error} {counts.error === 1 ? 'error' : 'errors'}
          </Badge>
          <Badge variant="outline">{counts.unscored} unscored</Badge>
          {total > completed && (
            <Badge variant="outline">
              {total - completed} {evaluation.status === 'running' ? 'pending' : 'not run'}
            </Badge>
          )}
        </div>
        <fieldset className="flex flex-wrap gap-2" aria-label="Filter evaluation tests">
          <Button
            type="button"
            size="sm"
            variant={filter === 'all' ? 'secondary' : 'ghost'}
            aria-pressed={filter === 'all'}
            onClick={() => setFilter('all')}
          >
            All tests ({evaluation.suite.cases.length})
          </Button>
          <Button
            type="button"
            size="sm"
            variant={filter === 'attention' ? 'secondary' : 'ghost'}
            aria-pressed={filter === 'attention'}
            disabled={!attention.length}
            onClick={() => setFilter('attention')}
          >
            Needs attention ({attention.length})
          </Button>
        </fieldset>
      </section>
      {filter === 'attention' && !cases.length && (
        <p role="status" className="text-sm text-muted-foreground">
          No tests need attention.
        </p>
      )}
      {cases.map((test) => {
        const judgment = evaluation.judge?.results.find((result) => result.caseId === test.id);
        return (
          <section
            key={test.id}
            className="grid min-w-0 gap-3 rounded-lg border p-3 sm:p-4"
            aria-label={`Results for ${test.name}`}
          >
            <h4 className="break-words text-sm font-semibold">{test.name}</h4>
            <details className="min-w-0 text-xs">
              <summary className="cursor-pointer">Test inputs &amp; expected answer</summary>
              <pre className="mt-2 overflow-auto whitespace-pre-wrap break-words">
                {JSON.stringify(test.inputs, null, 2)}
              </pre>
              {test.userMessage && <p className="mt-2 whitespace-pre-wrap break-words">{test.userMessage}</p>}
              {test.expected && <p className="mt-2 whitespace-pre-wrap break-words">Expected: {test.expected}</p>}
            </details>
            <div className={`grid min-w-0 gap-3 ${evaluation.candidates.length > 1 ? 'xl:grid-cols-2' : ''}`}>
              {evaluation.candidates.map((candidate, index) => {
                const result = evaluation.results.find(
                  (entry) => entry.caseId === test.id && entry.candidateId === candidate.id,
                );
                return (
                  <div
                    className="grid min-w-0 content-start gap-2 rounded-md border bg-muted/20 p-3"
                    key={candidate.id}
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2 text-xs">
                      <span className="min-w-0 break-all font-medium">
                        {String.fromCharCode(65 + index)} · {candidate.label}
                      </span>
                      <span className="rounded-full border px-2 py-0.5 capitalize">
                        {result?.status ?? (evaluation.status === 'running' ? 'Waiting' : 'Not run')}
                      </span>
                    </div>
                    <section
                      aria-label={`${candidate.label} output for ${test.name}`}
                      tabIndex={0}
                      className="max-h-96 min-h-24 overflow-auto whitespace-pre-wrap break-words font-mono text-sm leading-relaxed"
                    >
                      {result?.output || result?.error || 'No output yet.'}
                    </section>
                    {result?.error && <p className="break-words text-xs text-destructive">{result.error}</p>}
                    {result?.checks.map((check) => (
                      <p key={check.label} className="break-words text-xs">
                        {check.passed ? '✓ Pass' : '× Fail'} · {check.label}
                      </p>
                    ))}
                    {result?.status === 'unscored' && (
                      <p className="text-xs text-muted-foreground">
                        No automatic checks configured. Review this output or use a judge.
                      </p>
                    )}
                    <ToolCallHistory calls={result?.toolCalls ?? []} />
                    <details className="min-w-0 text-xs">
                      <summary className="cursor-pointer">
                        Prompt source{candidate.commit ? ` · ${candidate.commit.slice(0, 8)}` : ''}
                      </summary>
                      <section
                        aria-label={`${candidate.label} prompt source`}
                        tabIndex={0}
                        className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono"
                      >
                        {candidate.source}
                      </section>
                      {result && <p className="mt-2 break-all font-mono">Run: {result.runId}</p>}
                    </details>
                  </div>
                );
              })}
            </div>
            {evaluation.judge && (
              <div className="rounded-md border p-3 text-sm">
                <p className="font-medium">
                  LLM judge ·{' '}
                  {judgment
                    ? judgment.verdict === 'tie'
                      ? 'Tie'
                      : judgment.verdict === 'error'
                        ? 'Judge error'
                        : `Prefers ${judgment.verdict}`
                    : evaluation.status === 'running'
                      ? 'Waiting'
                      : 'Not completed'}
                </p>
                {judgment && <p className="mt-1 whitespace-pre-wrap break-words text-xs">{judgment.reason}</p>}
                <p className="mt-2 break-all text-xs text-muted-foreground">Judge model: {evaluation.judge.model}</p>
              </div>
            )}
          </section>
        );
      })}
      {evaluation.judge && (
        <details className="min-w-0 rounded-lg border p-3 text-sm">
          <summary className="cursor-pointer">Saved judge rubric</summary>
          <p className="mt-2 whitespace-pre-wrap break-words text-xs">{evaluation.judge.rubric}</p>
          <p className="mt-2 text-xs text-muted-foreground">
            Judgments are model opinions, saved separately from automatic checks.
          </p>
        </details>
      )}
      <Button
        type="button"
        variant="outline"
        className="justify-self-start"
        onClick={() => downloadRun(JSON.stringify(evaluation, null, 2), `evaluation-${evaluation.id}.json`)}
      >
        Export evaluation
      </Button>
    </article>
  );
}
