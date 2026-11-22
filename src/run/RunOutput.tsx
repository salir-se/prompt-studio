import { Button } from '@prompt-studio/ui/button';
import { useState } from 'react';
import { ToolCallHistory } from '../mcp/ToolCallHistory';
import type { RunRecord } from './contracts';
import { downloadRun, runError } from './run-client';

export function RunOutput({ run, busy, onCancel }: { run: RunRecord; busy: boolean; onCancel: () => void }) {
  const [message, setMessage] = useState<string | null>(null);
  async function copyOutput(): Promise<void> {
    try {
      if (!navigator.clipboard) throw new Error('Clipboard access is unavailable. Use Download output.');
      await navigator.clipboard.writeText(run.output);
      setMessage('Output copied.');
    } catch (error) {
      setMessage(`Copy failed: ${runError(error)}`);
    }
  }
  return (
    <article className="grid min-w-0 content-start gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="mb-1 text-xs font-medium uppercase tracking-wider text-muted-foreground">Saved run</p>
          <h3 className="text-lg font-semibold tracking-tight">Captured output</h3>
          <p className="break-all text-xs text-muted-foreground">
            {run.provider} / {run.model} · {new Date(run.startedAt).toLocaleString()}
          </p>
        </div>
        <span className="rounded-full border px-2 py-1 text-xs capitalize" role="status">
          {run.status}
        </span>
      </div>
      {run.status === 'running' && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted p-3 text-sm">
          <span>The model is working. You can close this workspace and return.</span>
          <Button type="button" variant="outline" disabled={busy} onClick={onCancel}>
            Cancel run
          </Button>
        </div>
      )}
      {run.error && (
        <p role="alert" className="rounded-md border border-destructive/50 p-3 text-sm text-red-700 dark:text-red-300">
          {run.error}
        </p>
      )}
      <section
        className="min-h-64 max-h-[60dvh] overflow-auto whitespace-pre-wrap break-words rounded-lg border bg-background p-5 font-mono text-sm leading-relaxed"
        tabIndex={0}
        aria-label="Model output"
      >
        {run.output || (run.status === 'running' ? 'Waiting for output…' : 'No output was captured.')}
      </section>
      <ToolCallHistory calls={run.toolCalls ?? []} />
      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" disabled={!run.output} onClick={() => void copyOutput()}>
          Copy output
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={!run.output}
          onClick={() => downloadRun(run.output, `prompt-run-${run.runId}.txt`)}
        >
          Download output
        </Button>
        <Button
          type="button"
          variant="ghost"
          onClick={() => downloadRun(JSON.stringify(run, null, 2), `prompt-run-${run.runId}.json`)}
        >
          Export run details
        </Button>
      </div>
      {message && (
        <p role="status" className="text-xs">
          {message}
        </p>
      )}
      {run.usage && (
        <p className="text-xs text-muted-foreground">
          {run.usage.inputTokens} input tokens · {run.usage.outputTokens} output tokens
          {run.stopReason ? ` · ${run.stopReason}` : ''}
        </p>
      )}
      <details className="min-w-0 rounded-lg border p-3">
        <summary className="cursor-pointer text-sm font-medium">Setup captured for this run</summary>
        <div className="mt-3 grid min-w-0 gap-3 text-xs">
          <p className="text-muted-foreground">
            This snapshot belongs to the selected run. Current setup changes do not alter it.
          </p>
          <p className="break-all font-mono">Source fingerprint: {run.sourceHash}</p>
          <section
            className="max-h-64 overflow-auto whitespace-pre-wrap break-words"
            tabIndex={0}
            aria-label="Run source"
          >
            {run.source}
          </section>
          <section className="overflow-auto whitespace-pre-wrap break-words">
            {JSON.stringify(run.inputs, null, 2)}
          </section>
          {run.userMessage && <p className="whitespace-pre-wrap break-words">User message: {run.userMessage}</p>}
          {run.toolDefinitions?.length ? (
            <details>
              <summary className="cursor-pointer">Captured tool schemas and execution modes</summary>
              <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words">
                {JSON.stringify(run.toolDefinitions, null, 2)}
              </pre>
            </details>
          ) : null}
          <p>Skills: {run.skills.map((skill) => skill.name).join(', ') || 'None'}</p>
          <p className="break-all">Project references: {run.files.map((file) => file.path).join(', ') || 'None'}</p>
          <details>
            <summary className="cursor-pointer">Resolved system instructions</summary>
            <section
              className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-words"
              tabIndex={0}
              aria-label="Resolved system instructions"
            >
              {run.systemPrompt}
            </section>
          </details>
        </div>
      </details>
    </article>
  );
}
