import { validateMermaidDiagram } from '@prompt-studio/prompt-graph-ui';
import {
  type JsonValue,
  parsePromptDesign,
  type PromptDesign,
  type PromptSectionDesign,
  validatePromptDesign,
  verifyStructuredJsonInput,
  verifyStructuredJsonOutput,
} from '@prompt-studio/prompts';
import { useEffect, useState } from 'react';
import { CloseButton } from '../components/CloseButton';
import { withSectionDesign } from '../design/section-metadata';
import { ShortcutControl } from '../shortcuts/ShortcutControl';
import { PromptContractDetails } from './PromptContractDetails';
import { type JsonSchemaValue, parseJsonSchema, schemaError } from './PromptDesignSchemaEditor';
import { PromptDesignTools } from './PromptDesignTools';

const FIELD = 'w-full rounded-md border border-input bg-background px-2 py-1.5 text-xs';
const JSON_FIELD = `${FIELD} min-h-28 font-mono`;

export interface PromptDesignPanelProps {
  design: PromptDesign;
  text: string;
  sectionId?: string;
  onSave: (design: PromptDesign) => Promise<void>;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
}

function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

export function PromptDesignPanel({
  design,
  text,
  sectionId,
  onSave,
  onClose,
  onDirtyChange,
}: PromptDesignPanelProps): React.JSX.Element {
  const [draft, setDraft] = useState(() => pretty(withSectionDesign(design, sectionId)));
  const [savedDraft, setSavedDraft] = useState(() => pretty(withSectionDesign(design, sectionId)));
  const [schemaDrafts, setSchemaDrafts] = useState<Partial<Record<'input' | 'output', string>>>({});
  const [sample, setSample] = useState('');
  const [sampleAxis, setSampleAxis] = useState<'input' | 'output'>('output');
  const [verifiedSampleAxis, setVerifiedSampleAxis] = useState<'input' | 'output' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const next = pretty(withSectionDesign(design, sectionId));
    setDraft(next);
    setSavedDraft(next);
    setSchemaDrafts({});
  }, [design, sectionId]);
  const dirty = draft !== savedDraft || Object.keys(schemaDrafts).length > 0;
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  const invalidSchema = Object.values(schemaDrafts).some((value) => schemaError(value) !== null);

  function parsed(): PromptDesign | null {
    try {
      const current = parsePromptDesign(draft);
      const apply = <T extends Pick<PromptSectionDesign, 'input' | 'output'>>(scope: T): T => {
        let next = scope;
        for (const axis of ['input', 'output'] as const) {
          const raw = schemaDrafts[axis];
          if (raw !== undefined && scope[axis].kind === 'json') {
            next = { ...next, [axis]: { ...scope[axis], jsonSchema: parseJsonSchema(raw) } };
          }
        }
        return next;
      };
      return sectionId
        ? {
            ...current,
            sectionDesigns: current.sectionDesigns.map((section) =>
              section.sectionId === sectionId ? apply(section) : section,
            ),
          }
        : apply(current);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  function replaceContract(axis: 'input' | 'output', value: string): void {
    const current = parsed();
    if (!current) return;
    const scope = sectionId ? current.sectionDesigns.find((section) => section.sectionId === sectionId) : current;
    if (!scope) return;
    let replacement: PromptSectionDesign['input'] | PromptSectionDesign['output'];
    if (axis === 'input') {
      replacement =
        value === 'json'
          ? { kind: 'json', description: 'Structured JSON input.', jsonSchema: { type: 'object' }, examples: [{}] }
          : { kind: 'free-text', description: 'Free-text user request.' };
    } else {
      replacement =
        value === 'json'
          ? { kind: 'json', description: 'Structured JSON response.', jsonSchema: { type: 'object' }, examples: [{}] }
          : value === 'tool-call'
            ? {
                kind: 'tool-call',
                description: 'Terminal tool call.',
                requiredToolName: current.tools[0] ?? 'tool_name',
              }
            : { kind: 'freeform', description: 'Free-text response.' };
    }
    updateDesign((prompt) =>
      sectionId
        ? {
            ...prompt,
            sectionDesigns: prompt.sectionDesigns.map((section) =>
              section.sectionId === sectionId ? { ...section, [axis]: replacement } : section,
            ),
          }
        : { ...prompt, [axis]: replacement },
    );
  }

  function replaceDescription(axis: 'input' | 'output', description: string): void {
    updateDesign((prompt) =>
      sectionId
        ? {
            ...prompt,
            sectionDesigns: prompt.sectionDesigns.map((section) =>
              section.sectionId === sectionId ? { ...section, [axis]: { ...section[axis], description } } : section,
            ),
          }
        : { ...prompt, [axis]: { ...prompt[axis], description } },
    );
  }

  function replaceJsonSchema(axis: 'input' | 'output', jsonSchema: JsonSchemaValue): void {
    setVerifiedSampleAxis(null);
    updateDesign((prompt) => {
      const updateScope = (current: PromptSectionDesign): PromptSectionDesign => {
        const contract = current[axis];
        return contract.kind === 'json' ? { ...current, [axis]: { ...contract, jsonSchema } } : current;
      };
      if (sectionId) {
        return {
          ...prompt,
          sectionDesigns: prompt.sectionDesigns.map((section) =>
            section.sectionId === sectionId ? updateScope(section) : section,
          ),
        };
      }
      const contract = prompt[axis];
      return contract.kind === 'json' ? { ...prompt, [axis]: { ...contract, jsonSchema } } : prompt;
    });
  }

  function replaceExamples(axis: 'input' | 'output', example: JsonValue): void {
    updateDesign((prompt) => {
      const updateScope = (current: PromptSectionDesign): PromptSectionDesign => {
        const contract = current[axis];
        return contract.kind === 'json' ? { ...current, [axis]: { ...contract, examples: [example] } } : current;
      };
      if (sectionId) {
        return {
          ...prompt,
          sectionDesigns: prompt.sectionDesigns.map((section) =>
            section.sectionId === sectionId ? updateScope(section) : section,
          ),
        };
      }
      const contract = prompt[axis];
      return contract.kind === 'json' ? { ...prompt, [axis]: { ...contract, examples: [example] } } : prompt;
    });
    setVerifiedSampleAxis(null);
  }

  function replaceRequiredToolName(requiredToolName: string): void {
    updateDesign((prompt) => {
      const updateScope = (current: PromptSectionDesign): PromptSectionDesign =>
        current.output.kind === 'tool-call' ? { ...current, output: { ...current.output, requiredToolName } } : current;
      if (sectionId) {
        return {
          ...prompt,
          sectionDesigns: prompt.sectionDesigns.map((section) =>
            section.sectionId === sectionId ? updateScope(section) : section,
          ),
        };
      }
      return prompt.output.kind === 'tool-call'
        ? { ...prompt, output: { ...prompt.output, requiredToolName } }
        : prompt;
    });
  }

  function updateDesign(update: (current: PromptDesign) => PromptDesign): void {
    const current = parsed();
    if (!current) return;
    setDraft(pretty({ ...update(current), version: current.version + 1 }));
    setSchemaDrafts({});
    setMessage(null);
  }

  function testSample(): void {
    const current = parsed();
    if (!current) return;
    const scope = sectionId ? current.sectionDesigns.find((section) => section.sectionId === sectionId) : current;
    if (!scope) return;
    const axis =
      scope.input.kind === 'json' && (sampleAxis === 'input' || scope.output.kind !== 'json') ? 'input' : 'output';
    const result =
      axis === 'input' && scope.input.kind === 'json'
        ? verifyStructuredJsonInput(scope.input, sample)
        : scope.output.kind === 'json'
          ? verifyStructuredJsonOutput(scope.output, sample)
          : scope.input.kind === 'json'
            ? verifyStructuredJsonInput(scope.input, sample)
            : null;
    setVerifiedSampleAxis(result?.valid ? axis : null);
    setMessage(
      result
        ? result.valid
          ? 'Sample matches the JSON schema.'
          : result.errors.join('\n')
        : 'Select JSON input or output first.',
    );
  }

  async function save(): Promise<void> {
    const current = parsed();
    if (!current) return;
    const issues = validatePromptDesign(current, text);
    if (issues.length > 0) {
      setMessage(issues.map((issue) => issue.message).join('\n'));
      return;
    }
    const workflows = [
      { label: 'Major workflow', diagram: current.workflow },
      ...current.sectionDesigns.map((section) => ({
        label: `Workflow for ${section.sectionId}`,
        diagram: section.workflow,
      })),
    ].filter((workflow) => workflow.diagram.trim() !== '');
    setSaving(true);
    const results = await Promise.all(
      workflows.map(async (workflow) => ({
        ...workflow,
        result: await validateMermaidDiagram(workflow.diagram),
      })),
    );
    const invalid = results.filter((workflow) => !workflow.result.valid);
    if (invalid.length > 0) {
      setSaving(false);
      setMessage(
        invalid
          .map((workflow) =>
            `${workflow.label} cannot render: ${workflow.result.valid ? '' : workflow.result.error}`.trim(),
          )
          .join('\n'),
      );
      return;
    }
    try {
      await onSave(current);
      const saved = pretty(current);
      setDraft(saved);
      setSavedDraft(saved);
      setSchemaDrafts({});
      setMessage('Prompt design saved and ready.');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  }

  const current = (() => {
    try {
      return parsePromptDesign(draft);
    } catch {
      return null;
    }
  })();
  const issues = current ? validatePromptDesign(current, text) : [];
  const scope = sectionId ? current?.sectionDesigns.find((section) => section.sectionId === sectionId) : current;

  return (
    <aside
      aria-label="Prompt design"
      onKeyDown={(event) => {
        if (event.target instanceof Element) {
          const overlay = event.target.closest('[role="dialog"], [role="menu"]');
          if (overlay && overlay !== event.currentTarget.closest('[role="dialog"]')) return;
        }
        if (
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          !event.repeat &&
          !event.nativeEvent.isComposing &&
          event.key.toLowerCase() === 's'
        ) {
          event.preventDefault();
          event.stopPropagation();
          if (!saving && !invalidSchema) void save();
        }
      }}
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-border bg-card shadow-xl sm:w-[min(680px,calc(100vw-3rem))]"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div>
          <h2 className="text-xl font-semibold tracking-tight">{sectionId ? 'Sub-prompt design' : 'Prompt design'}</h2>
          {sectionId && <p className="font-mono text-[11px] text-muted-foreground">{sectionId}</p>}
          <p className="mt-1 text-xs text-muted-foreground">
            {sectionId ? 'Selected section' : 'Whole prompt'} · Input → workflow → output
          </p>
        </div>
        <CloseButton onClick={onClose} />
      </header>
      <fieldset disabled={saving} className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto p-5 sm:p-6">
        {current && (
          <PromptDesignTools
            tools={current.tools}
            onChange={(tools) => updateDesign((prompt) => ({ ...prompt, tools }))}
          />
        )}
        {current && scope && (
          <PromptContractDetails
            scope={scope}
            sectionId={sectionId}
            schemaDrafts={schemaDrafts}
            onDescriptionChange={replaceDescription}
            onContractChange={replaceContract}
            onSchemaCommit={replaceJsonSchema}
            onRequiredToolChange={replaceRequiredToolName}
            onSchemaChange={(axis, value) => {
              setSchemaDrafts((current) => ({ ...current, [axis]: value }));
              setVerifiedSampleAxis(null);
            }}
            onWorkflowChange={(workflow) =>
              updateDesign((prompt) =>
                sectionId
                  ? {
                      ...prompt,
                      sectionDesigns: prompt.sectionDesigns.map((section) =>
                        section.sectionId === sectionId ? { ...section, workflow } : section,
                      ),
                    }
                  : { ...prompt, workflow },
              )
            }
          />
        )}

        <details className="rounded-md border border-border p-3">
          <summary className="cursor-pointer text-xs font-semibold">Advanced: complete versioned design</summary>
          <label className="mt-3 block text-xs font-medium">
            Prompt design JSON
            <textarea
              aria-label="Prompt design JSON"
              className={JSON_FIELD}
              rows={24}
              value={draft}
              onChange={(event) => {
                setDraft(event.target.value);
                setMessage(null);
              }}
            />
          </label>
        </details>

        {(scope?.input.kind === 'json' || scope?.output.kind === 'json') && (
          <section className="space-y-2 rounded-md border border-border p-3">
            <h3 className="text-xs font-semibold">Test structured JSON</h3>
            {scope.input.kind === 'json' && scope.output.kind === 'json' && (
              <label className="block text-xs font-medium">
                Contract to verify
                <select
                  aria-label="JSON contract to verify"
                  className={FIELD}
                  value={sampleAxis}
                  onChange={(event) => setSampleAxis(event.target.value as 'input' | 'output')}
                >
                  <option value="input">Input</option>
                  <option value="output">Output</option>
                </select>
              </label>
            )}
            <textarea
              aria-label="JSON sample to verify"
              className={JSON_FIELD}
              value={sample}
              onChange={(event) => {
                setSample(event.target.value);
                setVerifiedSampleAxis(null);
              }}
              placeholder="Paste an actual model payload"
            />
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={testSample} className="rounded-md border border-input px-3 py-1.5 text-xs">
                Verify sample
              </button>
              {verifiedSampleAxis && (
                <button
                  type="button"
                  onClick={() => replaceExamples(verifiedSampleAxis, JSON.parse(sample))}
                  className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground"
                >
                  Use verified sample as example
                </button>
              )}
            </div>
          </section>
        )}

        <section aria-label="Readiness" className="rounded-md border border-border p-3 text-xs">
          <h3 className="font-semibold">Readiness</h3>
          {!current ? (
            <p className="mt-1 text-destructive">The design JSON is invalid.</p>
          ) : issues.length === 0 ? (
            <p className="mt-1 text-emerald-700 dark:text-emerald-300">
              Structurally ready. Mermaid syntax is previewed here and checked before saving.
            </p>
          ) : (
            <ul className="mt-1 list-disc space-y-1 pl-4 text-amber-700 dark:text-amber-300">
              {issues.map((issue) => (
                <li key={`${issue.code}-${issue.subject ?? issue.message}`}>{issue.message}</li>
              ))}
            </ul>
          )}
        </section>
        {current && current.verificationProfiles.length > 0 && (
          <details aria-label="Verification dependency graph" className="rounded-md border border-border p-3 text-xs">
            <summary className="cursor-pointer font-semibold">Verification dependencies</summary>
            <div className="mt-2 space-y-1 font-mono text-[11px]">
              {current.verificationProfiles.map((profile) => (
                <div key={profile.id} className="flex flex-wrap items-center gap-1 rounded bg-muted/60 px-2 py-1">
                  <span>{profile.id}</span>
                  {(profile.dependsOn ?? []).length === 0 ? (
                    <span className="text-muted-foreground">(independent)</span>
                  ) : (
                    (profile.dependsOn ?? []).map((dependency) => (
                      <span key={dependency} className="font-medium text-foreground">
                        → {dependency}
                      </span>
                    ))
                  )}
                </div>
              ))}
            </div>
          </details>
        )}
      </fieldset>
      <footer className="shrink-0 space-y-3 border-t border-border bg-card p-4">
        <p className="text-xs text-muted-foreground">
          {!current
            ? 'Invalid design JSON'
            : invalidSchema
              ? 'Check the JSON schema'
              : issues.length
                ? `${issues.length} readiness issues to review`
                : 'Structurally ready'}{' '}
          · {dirty ? 'Unsaved changes' : 'Saved version'} · Ctrl / ⌘ + S
        </p>
        {message && (
          <pre role="status" className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted p-3 text-xs">
            {message}
          </pre>
        )}
        <ShortcutControl id={'saveDesign'}>
          <button
            type="button"
            disabled={saving || invalidSchema}
            aria-keyshortcuts="Control+S Meta+S"
            onClick={() => void save()}
            className="w-full rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground disabled:opacity-50"
          >
            {saving ? 'Saving…' : 'Save prompt design'}
          </button>
        </ShortcutControl>
      </footer>
    </aside>
  );
}
