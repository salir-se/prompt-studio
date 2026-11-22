import { Button } from '@prompt-studio/ui/button';
import { Input } from '@prompt-studio/ui/input';
import { Label } from '@prompt-studio/ui/label';
import { Textarea } from '@prompt-studio/ui/textarea';
import { useId, useState } from 'react';
import { ToolBindingsEditor } from '../mcp/ToolBindingsEditor';
import type { StudioMcpServer, ToolBinding } from '../mcp/contracts';
import { InputValues, RUN_FIELD } from './RunFields';
import type { EvalCase } from './contracts';
import { promptVariables } from './run-client';
import { type EvaluationSession, newEvalCase } from './use-evaluation-session';

function CaseEditor({
  value,
  names,
  onChange,
  onRemove,
  expanded,
  onExpand,
  servers,
  defaultTools,
}: {
  value: EvalCase;
  servers?: StudioMcpServer[];
  defaultTools?: ToolBinding[];
  names: string[];
  onChange: (value: EvalCase) => void;
  onRemove: () => void;
  expanded: boolean;
  onExpand: () => void;
}) {
  const id = useId();
  const checks = value.checks;
  const checkCount =
    (checks.contains?.filter((value) => value.trim()).length ?? 0) +
    (checks.notContains?.filter((value) => value.trim()).length ?? 0) +
    Number(Boolean(checks.json)) +
    Number(checks.equals !== undefined);
  const inputCount = names.filter((name) => value.inputs[name]?.trim()).length;
  return (
    <section className="min-w-0 rounded-lg border bg-card p-4">
      <Button
        type="button"
        variant="ghost"
        className="block h-auto w-full whitespace-normal p-0 text-left text-sm"
        aria-expanded={expanded}
        aria-controls={id}
        onClick={onExpand}
      >
        <span className="flex items-start justify-between gap-3">
          <span className="min-w-0 break-words font-medium">{value.name || 'Unnamed test'}</span>
          <span
            aria-hidden="true"
            className={`mt-0.5 size-4 shrink-0 transition-transform ${expanded ? 'rotate-180' : ''}`}
          >
            ▾
          </span>
        </span>
        <span className="mt-1 block text-xs text-muted-foreground">
          {names.length ? `${inputCount}/${names.length} detected inputs filled` : 'No detected inputs'} · {checkCount}{' '}
          automatic checks
        </span>
      </Button>
      <div id={id} hidden={!expanded}>
        <div className="mt-4 grid min-w-0 gap-4">
          <Label className="grid gap-1.5 text-sm">
            Test name
            <Input value={value.name} onChange={(event) => onChange({ ...value, name: event.target.value })} />
          </Label>
          <details className="min-w-0 rounded-lg border p-3">
            <summary className="cursor-pointer text-sm font-medium">Tool responses for this test</summary>
            <div className="mt-3 grid gap-3">
              <Label className="flex items-center gap-2 text-xs">
                <input
                  type="checkbox"
                  checked={value.tools !== undefined}
                  onChange={(event) =>
                    onChange({
                      ...value,
                      tools: event.target.checked ? structuredClone(defaultTools ?? []) : undefined,
                    })
                  }
                />
                Override the shared tool responses
              </Label>
              {value.tools !== undefined ? (
                <ToolBindingsEditor
                  value={value.tools}
                  servers={servers}
                  onChange={(tools) => onChange({ ...value, tools })}
                />
              ) : (
                <p className="text-xs text-muted-foreground">
                  Uses the shared run setup. Override it to test another response or switch a tool between mock and
                  real.
                </p>
              )}
            </div>
          </details>
          <InputValues names={names} value={value.inputs} onChange={(inputs) => onChange({ ...value, inputs })} />
          <Label className="grid gap-1.5 text-sm">
            Test user message
            <Textarea
              rows={2}
              value={value.userMessage}
              onChange={(event) => onChange({ ...value, userMessage: event.target.value })}
            />
          </Label>
          <Label className="grid gap-1.5 text-sm">
            Expected answer or guidance{' '}
            <span className="text-xs text-muted-foreground">
              Reference for review and optional judging. Add a check below for an automatic score.
            </span>
            <Textarea
              rows={2}
              value={value.expected ?? ''}
              onChange={(event) => onChange({ ...value, expected: event.target.value })}
            />
          </Label>
          <fieldset className="grid min-w-0 gap-3 rounded-md bg-muted/30 p-3">
            <legend className="px-1 text-sm font-medium">Automatic checks</legend>
            <Label className="grid gap-1 text-sm">
              Must include <span className="text-xs text-muted-foreground">One phrase per line</span>
              <Textarea
                rows={2}
                value={checks.contains?.join('\n') ?? ''}
                onChange={(event) =>
                  onChange({ ...value, checks: { ...checks, contains: event.target.value.split('\n') } })
                }
              />
            </Label>
            <Label className="grid gap-1 text-sm">
              Must exclude <span className="text-xs text-muted-foreground">One phrase per line</span>
              <Textarea
                rows={2}
                value={checks.notContains?.join('\n') ?? ''}
                onChange={(event) =>
                  onChange({ ...value, checks: { ...checks, notContains: event.target.value.split('\n') } })
                }
              />
            </Label>
            <Label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                className="size-4 accent-primary"
                checked={Boolean(checks.json)}
                onChange={(event) => onChange({ ...value, checks: { ...checks, json: event.target.checked } })}
              />
              Require valid JSON
            </Label>
            <details>
              <summary className="cursor-pointer text-xs">Exact output check</summary>
              <Label className="mt-2 grid gap-1 text-sm">
                Output must equal
                <Textarea
                  value={checks.equals ?? ''}
                  onChange={(event) => {
                    const next = { ...checks };
                    if (event.target.value) next.equals = event.target.value;
                    else delete next.equals;
                    onChange({ ...value, checks: next });
                  }}
                />
              </Label>
            </details>
          </fieldset>
          <Button type="button" variant="ghost" className="justify-self-start text-destructive" onClick={onRemove}>
            Remove test
          </Button>
        </div>
      </div>
    </section>
  );
}

export function SuiteEditor({
  session,
  source,
  servers,
  defaultTools,
}: {
  session: EvaluationSession;
  source: string;
  servers?: StudioMcpServer[];
  defaultTools?: ToolBinding[];
}) {
  const { suite } = session;
  const [selectedCase, setSelectedCase] = useState<string | null | undefined>(undefined);
  return (
    <div className="grid min-w-0 content-start gap-4">
      <div className="flex flex-wrap items-end gap-2">
        <Label className="grid min-w-0 flex-1 gap-1 text-sm">
          Saved test suite
          <select
            className={RUN_FIELD}
            value={suite?.id ?? ''}
            onChange={(event) => {
              session.chooseSuite(event.target.value);
              setSelectedCase(undefined);
            }}
          >
            <option value="">Select a suite</option>
            {session.suites.map((entry) => (
              <option key={entry.id} value={entry.id}>
                {entry.name} · {entry.cases.length} test{entry.cases.length === 1 ? '' : 's'}
              </option>
            ))}
            {suite && !session.suites.some((entry) => entry.id === suite.id) && (
              <option value={suite.id}>{suite.name} · Unsaved</option>
            )}
          </select>
        </Label>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            session.createSuite();
            setSelectedCase(undefined);
          }}
          disabled={session.busy}
        >
          New suite
        </Button>
      </div>
      {suite ? (
        <details
          className="min-w-0 rounded-lg border p-3"
          open={!session.suites.some((entry) => entry.id === suite.id)}
        >
          <summary className="cursor-pointer text-sm font-medium">
            Edit suite · {suite.cases.length} test{suite.cases.length === 1 ? '' : 's'}
          </summary>
          <fieldset className="mt-4 grid min-w-0 gap-4" disabled={session.busy}>
            <Label className="grid gap-1.5 text-sm">
              Suite name
              <Input
                value={suite.name}
                onChange={(event) => session.setSuite({ ...suite, name: event.target.value })}
              />
            </Label>
            <p className="text-xs text-muted-foreground">
              Each test runs independently with its own inputs. Results keep a snapshot of this suite.
            </p>
            {suite.cases.map((test, index) => (
              <CaseEditor
                key={test.id}
                value={test}
                names={promptVariables(source)}
                servers={servers}
                defaultTools={defaultTools}
                expanded={selectedCase === undefined ? index === 0 : selectedCase === test.id}
                onExpand={() =>
                  setSelectedCase(
                    (selectedCase === undefined ? index === 0 : selectedCase === test.id) ? null : test.id,
                  )
                }
                onChange={(next) =>
                  session.setSuite({
                    ...suite,
                    cases: suite.cases.map((entry) => (entry.id === test.id ? next : entry)),
                  })
                }
                onRemove={() =>
                  session.setSuite({ ...suite, cases: suite.cases.filter((entry) => entry.id !== test.id) })
                }
              />
            ))}
            {suite.cases.length === 0 && (
              <p className="rounded-lg border border-dashed p-4 text-sm">
                Add at least one test before running this suite.
              </p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  const test = newEvalCase();
                  session.setSuite({ ...suite, cases: [...suite.cases, test] });
                  setSelectedCase(test.id);
                }}
              >
                Add test
              </Button>
              <Button
                type="button"
                disabled={
                  session.projectPending || session.busy || !session.dirty || !suite.name.trim() || !suite.cases.length
                }
                onClick={() => void session.saveSuite()}
              >
                Save suite
              </Button>
              {session.dirty && (
                <Button type="button" variant="ghost" onClick={session.discard}>
                  Discard suite edits
                </Button>
              )}
            </div>
          </fieldset>
        </details>
      ) : (
        <div className="rounded-lg border border-dashed p-6 text-sm text-muted-foreground">
          Save a few representative cases once, then reuse them across prompts and Git tags.
        </div>
      )}
    </div>
  );
}
