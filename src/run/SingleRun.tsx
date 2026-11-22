import { Button } from '@prompt-studio/ui/button';
import { Label } from '@prompt-studio/ui/label';
import { Textarea } from '@prompt-studio/ui/textarea';
import { useRef } from 'react';
import { ShortcutControl } from '../shortcuts/ShortcutControl';
import { InputValues, RUN_FIELD } from './RunFields';
import { RunOutput } from './RunOutput';
import { RunSetupFields } from './RunSetupFields';
import { promptVariables } from './run-client';
import type { RunSession } from './use-run-session';

export function SingleRun({
  session,
  source,
  draft,
  onSettings,
}: {
  session: RunSession;
  source: string;
  draft: boolean;
  onSettings: () => void;
}) {
  const output = useRef<HTMLElement>(null);
  const { setup, setSetup, settings, selected } = session;
  const blockedReason = session.projectPending
    ? 'Wait for project changes to save.'
    : !session.connected
      ? 'Connect a model before running this prompt.'
      : !setup.model.trim()
        ? 'Choose a model before running this prompt.'
        : '';
  const actionLabel = session.running ? 'Running…' : draft ? 'Run draft' : 'Run prompt';
  return (
    <div className="flex min-h-full flex-col">
      <div className="grid min-h-0 min-w-0 flex-1 lg:grid-cols-[minmax(280px,0.85fr)_minmax(0,1.3fr)]">
        <div className="grid min-w-0 content-start gap-5 border-b p-4 sm:p-6 lg:border-r lg:border-b-0">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Current setup</p>
            <h3 className="mt-1 text-lg font-semibold tracking-tight">Try this prompt</h3>
            <p className="mt-1 text-sm text-muted-foreground">
              {draft
                ? 'Runs the current writing draft without applying it to the project.'
                : 'Runs the current prompt.'}{' '}
              Inputs and attached project files are sent to the selected model.
            </p>
          </div>
          <RunSetupFields
            setup={setup}
            settings={settings}
            connected={session.connected}
            onChange={setSetup}
            onSettings={onSettings}
          />
          <InputValues
            value={setup.inputs}
            names={promptVariables(source)}
            onChange={(inputs) => setSetup({ ...setup, inputs })}
          />
          <Label className="grid min-w-0 gap-1.5 text-sm">
            User message{' '}
            <span className="text-xs text-muted-foreground">Optional request sent after the prompt instructions.</span>
            <Textarea
              rows={3}
              value={setup.userMessage}
              onChange={(event) => setSetup({ ...setup, userMessage: event.target.value })}
            />
          </Label>
        </div>
        <section
          ref={output}
          tabIndex={-1}
          aria-label="Run history and output"
          className="grid min-w-0 content-start gap-4 p-4 sm:p-6"
        >
          <Label className="grid min-w-0 gap-1.5 text-sm">
            Run history
            <select
              className={RUN_FIELD}
              value={session.selectedId ?? ''}
              onChange={(event) => session.setSelectedId(event.target.value)}
              disabled={session.runs.length === 0}
            >
              {session.runs.length === 0 && <option value="">No runs yet</option>}
              {session.runs.map((run) => (
                <option key={run.runId} value={run.runId}>
                  {new Date(run.startedAt).toLocaleString()} · {run.model} · {run.status}
                </option>
              ))}
            </select>
          </Label>
          {selected ? (
            <RunOutput
              key={selected.runId}
              run={selected}
              busy={session.busy}
              onCancel={() => void session.cancel(selected.runId)}
            />
          ) : (
            <div className="grid min-h-64 place-content-center rounded-xl border border-dashed p-8 text-center">
              <h3 className="font-semibold">See what your prompt produces</h3>
              <p className="mt-2 max-w-xs text-sm text-muted-foreground">
                Choose a model, fill the inputs, then run. The output and exact source stay together in history.
              </p>
            </div>
          )}
        </section>
      </div>
      <section
        className="sticky bottom-0 z-10 border-t bg-background px-4 py-3 shadow-[0_-4px_12px_0_rgb(0_0_0/0.04)] sm:px-6"
        aria-label="Single run actions"
      >
        {blockedReason && (
          <div className="mb-2 flex flex-wrap items-center gap-x-3 gap-y-1">
            <p role="status" className="text-sm">
              {blockedReason}
            </p>
            {(!session.connected || !setup.model.trim()) && !session.projectPending && (
              <Button type="button" variant="link" size="sm" onClick={onSettings}>
                {!session.connected ? 'Connect a model' : 'Choose a model'}
              </Button>
            )}
          </div>
        )}
        <div className="flex flex-wrap gap-2">
          <ShortcutControl id={'runSingle'}>
            <Button
              type="button"
              disabled={
                session.projectPending || session.busy || session.running || !session.connected || !setup.model.trim()
              }
              aria-label={actionLabel}
              aria-keyshortcuts="Control+Enter Meta+Enter"
              onClick={() => void session.run()}
            >
              {actionLabel}
              <kbd className="ml-2 text-[10px] opacity-70">⌘/Ctrl ↵</kbd>
            </Button>
          </ShortcutControl>
          {selected && (
            <Button
              type="button"
              variant="ghost"
              onClick={() => {
                output.current?.focus();
                output.current?.scrollIntoView({ block: 'start' });
              }}
            >
              View output
            </Button>
          )}
          {session.dirty && (
            <Button
              type="button"
              variant="outline"
              disabled={session.busy || session.projectPending}
              onClick={() => void session.saveProfile()}
            >
              Save run setup
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Runs and outputs are saved locally. Provider charges may apply. Project access is read-only.
        </p>
      </section>
    </div>
  );
}
