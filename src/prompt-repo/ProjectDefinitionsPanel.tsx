import { TimelineScrollRegion } from '@prompt-studio/ui/timeline-scroll-region';
import { useEffect, useRef } from 'react';
import { CloseButton } from '../components/CloseButton';
import {
  BUTTON_BASE_CLASSES,
  BUTTON_DEFAULT_CLASSES,
  BUTTON_OUTLINE_CLASSES,
  BUTTON_SM_CLASSES,
  cn,
} from '../components/ui-classes';
import { McpToolImport } from '../mcp/McpToolImport';
import type { DefinitionKind } from './definition-transfer';
import type { ProjectDefinitions, ProjectVariable } from './project-definitions';
import { type DefinitionEditor, useDefinitionsEditor } from './use-definitions-editor';

export interface ProjectDefinitionsPanelProps {
  definitions: ProjectDefinitions;
  onSave: (next: ProjectDefinitions) => Promise<void>;
  references?: Record<string, readonly string[]>;
  onClose: () => void;
  kind: DefinitionKind;
  onDirtyChange?: (dirty: boolean) => void;
}
const fieldClass = 'w-full min-w-0 rounded border border-input bg-background px-2 py-2 text-sm';
const primary = cn(BUTTON_BASE_CLASSES, BUTTON_DEFAULT_CLASSES, BUTTON_SM_CLASSES);
const secondary = cn(BUTTON_BASE_CLASSES, BUTTON_OUTLINE_CLASSES, BUTTON_SM_CLASSES);

export function ProjectDefinitionsPanel(props: ProjectDefinitionsPanelProps) {
  const { definitions, kind, references = {}, onClose, onDirtyChange } = props;
  const state = useDefinitionsEditor(props);
  useEffect(() => {
    onDirtyChange?.(state.dirty);
  }, [state.dirty, onDirtyChange]);
  const uploadInput = useRef<HTMLInputElement>(null);
  const editorForm = useRef<HTMLFormElement>(null);
  const singular = kind === 'variables' ? 'variable' : 'tool';
  const title = kind === 'variables' ? 'Variables' : 'Tools';
  const { editor } = state;
  const editingReferences = editor?.originalName ? (references[editor.originalName] ?? []) : [];
  const change = (patch: Partial<DefinitionEditor>) =>
    state.setEditor((current) => current && { ...current, ...patch });
  return (
    <aside
      aria-label={`Project ${kind}`}
      className="fixed inset-y-0 right-0 z-40 flex w-full sm:w-[min(640px,calc(100vw-3rem))] flex-col border-l border-border bg-card text-foreground shadow-xl"
    >
      <header className="flex shrink-0 items-start justify-between gap-4 border-b border-border px-6 py-5">
        <div>
          <p className="mb-1 text-xs font-medium text-muted-foreground">Project definitions</p>
          <h2 className="text-xl font-semibold tracking-tight">
            {title} <span className="text-muted-foreground">({definitions[kind].length})</span>
          </h2>
        </div>
        <CloseButton onClick={onClose} disabled={state.busy} />
      </header>
      <TimelineScrollRegion className="min-h-0 flex-1" viewportClassName="space-y-5 p-5 sm:p-6">
        <p className="text-sm text-muted-foreground">
          {kind === 'variables'
            ? 'Reusable values available to prompts in this project. Use examples, never passwords or access tokens.'
            : 'Define tools here or import their schemas from MCP. Choose real calls or mock responses separately in Run and test setup.'}
        </p>
        {state.error && (
          <p role="alert" className="break-words text-sm text-destructive">
            {state.error}
          </p>
        )}
        {state.notice && (
          <p role="status" className="text-sm">
            {state.notice}
          </p>
        )}
        {state.busy && (
          <p role="status" className="text-sm">
            Saving…
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primary} disabled={state.busy} onClick={state.create}>
            Add {singular}
          </button>
          <button
            type="button"
            className={secondary}
            disabled={state.busy}
            onClick={() => uploadInput.current?.click()}
          >
            Import {kind}
          </button>
          <button type="button" className={secondary} disabled={state.busy} onClick={state.download}>
            Export {kind}
          </button>
          <input
            ref={uploadInput}
            type="file"
            accept=".json,application/json"
            aria-label={`Upload ${kind} JSON`}
            className="sr-only"
            disabled={state.busy}
            onChange={(event) => {
              const file = event.currentTarget.files?.[0];
              event.currentTarget.value = '';
              if (file) void state.upload(file);
            }}
          />
        </div>
        {kind === 'tools' && (
          <McpToolImport
            onChoose={(tool) => {
              if (!state.createFromTool(tool)) return false;
              requestAnimationFrame(() => editorForm.current?.querySelector('input')?.focus());
              return true;
            }}
            disabled={state.busy}
          />
        )}
        {state.imported && (
          <section aria-label="Import preview" className="space-y-3 rounded border border-border p-3 text-sm">
            <h3 className="font-medium">Import preview</h3>
            <p>
              {state.imported[kind].length} {kind} in this file; {state.conflicts.length} existing names.
            </p>
            {state.conflicts.length > 0 && (
              <>
                <p className="break-words">Existing names: {state.conflicts.join(', ')}</p>
                <label className="block space-y-1">
                  <span>When a name already exists</span>
                  <select
                    className={fieldClass}
                    value={state.conflictChoice}
                    disabled={state.busy}
                    onChange={(event) => state.setConflictChoice(event.target.value as 'keep' | 'replace' | '')}
                  >
                    <option value="">Choose how to resolve conflicts</option>
                    <option value="keep">Keep existing definitions</option>
                    <option value="replace">Replace with imported definitions</option>
                  </select>
                </label>
              </>
            )}
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={primary}
                disabled={state.busy || (state.conflicts.length > 0 && !state.conflictChoice)}
                onClick={() => void state.applyImport()}
              >
                Import into project
              </button>
              <button type="button" className={secondary} disabled={state.busy} onClick={() => state.setImported(null)}>
                Cancel import
              </button>
            </div>
          </section>
        )}
        {editor && (
          <form
            id="project-definition-editor"
            ref={editorForm}
            className="space-y-4 rounded-xl border border-border bg-muted/15 p-5"
            onSubmit={(event) => {
              event.preventDefault();
              void state.saveEditor();
            }}
          >
            <h3 className="text-base font-semibold tracking-tight">
              {editor.originalName ? 'Edit' : 'Add'} {singular}
            </h3>
            <fieldset disabled={state.busy} className="min-w-0 space-y-3">
              <label className="block space-y-1 text-sm">
                <span>Name</span>
                <input
                  required
                  pattern="[A-Za-z_][A-Za-z0-9_.\-]*"
                  className={fieldClass}
                  value={editor.name}
                  disabled={!!editor.originalName}
                  onChange={(event) => change({ name: event.target.value })}
                />
              </label>
              {editingReferences.length > 0 && (
                <p className="break-words text-xs text-muted-foreground">
                  Name is used by {editingReferences.join(', ')}. Create a new definition to use a different name.
                </p>
              )}
              <label className="block space-y-1 text-sm">
                <span>{kind === 'variables' ? 'Purpose' : 'Description'}</span>
                <textarea
                  required
                  rows={2}
                  className={fieldClass}
                  value={editor.description}
                  onChange={(event) => change({ description: event.target.value })}
                />
              </label>
              {kind === 'variables' ? (
                <>
                  <label className="block space-y-1 text-sm">
                    <span>Example value</span>
                    <input
                      className={fieldClass}
                      value={editor.sample}
                      onChange={(event) => change({ sample: event.target.value })}
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={editor.required}
                      onChange={(event) => change({ required: event.target.checked })}
                    />
                    Required
                  </label>
                  <details className="rounded-lg border border-border p-3">
                    <summary className="cursor-pointer text-sm">Advanced settings</summary>
                    <div className="mt-3 space-y-3">
                      <p className="text-xs leading-relaxed text-muted-foreground">
                        Control where the value comes from, how it is encoded, and what appears in previews. Server-only
                        and redacted values must not contain examples.
                      </p>
                      <label className="block text-sm">
                        Value source
                        <select
                          className={fieldClass}
                          value={editor.lifecycle}
                          onChange={(event) =>
                            change({ lifecycle: event.target.value as ProjectVariable['lifecycle'] })
                          }
                        >
                          <option value="runtime">Provided when the prompt runs</option>
                          <option value="configuration">Project configuration</option>
                          <option value="server-only">Server only (no example value)</option>
                        </select>
                      </label>
                      <label className="block text-sm">
                        Encoding
                        <select
                          className={fieldClass}
                          value={editor.encoding}
                          onChange={(event) => change({ encoding: event.target.value as ProjectVariable['encoding'] })}
                        >
                          <option value="xml-text">Text</option>
                          <option value="json">JSON</option>
                        </select>
                      </label>
                      <label className="block text-sm">
                        Preview
                        <select
                          className={fieldClass}
                          value={editor.presentation}
                          onChange={(event) =>
                            change({ presentation: event.target.value as ProjectVariable['presentation'] })
                          }
                        >
                          <option value="placeholder">Placeholder</option>
                          <option value="resolved">Example value</option>
                          <option value="redacted">Redacted (no example value)</option>
                        </select>
                      </label>
                    </div>
                  </details>
                </>
              ) : (
                <label className="block space-y-1 text-sm">
                  <span>Input JSON Schema</span>
                  <textarea
                    required
                    rows={8}
                    spellCheck={false}
                    className={`${fieldClass} font-mono`}
                    value={editor.schema}
                    onChange={(event) => change({ schema: event.target.value })}
                  />
                  <span className="block text-xs text-muted-foreground">
                    Describe the input fields the tool accepts as a JSON object.
                  </span>
                </label>
              )}
            </fieldset>
          </form>
        )}
        {definitions[kind].length === 0 && !editor && (
          <p className="text-sm text-muted-foreground">No {kind} yet. Add one or import a JSON file.</p>
        )}
        <ul className="space-y-3">
          {definitions[kind].map((entry) => (
            <li
              key={entry.name}
              className="min-w-0 space-y-3 rounded-xl border border-border bg-background/50 p-4 text-sm"
            >
              <h3 className="break-words font-mono text-sm font-semibold">{entry.name}</h3>
              <p className="break-words text-muted-foreground">
                {'purpose' in entry ? entry.purpose : entry.description}
              </p>
              {(references[entry.name]?.length ?? 0) > 0 && (
                <p className="break-words border-l-2 border-border pl-3 text-xs text-muted-foreground">
                  Used by: {references[entry.name].join(', ')}
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={secondary}
                  aria-label={`Edit ${entry.name}`}
                  disabled={state.busy}
                  onClick={() => state.edit(entry)}
                >
                  Edit
                </button>
                <button
                  type="button"
                  className={secondary}
                  aria-label={`Delete ${entry.name}`}
                  disabled={state.busy}
                  onClick={() => {
                    if (references[entry.name]?.length) state.setPendingDelete(entry.name);
                    else void state.remove(entry.name);
                  }}
                >
                  Delete
                </button>
              </div>
              {state.pendingDelete === entry.name && (
                <div className="space-y-2" role="alert">
                  <p>
                    Deleting this {singular} leaves references in {references[entry.name].join(', ')} unresolved. Update
                    those prompts after deleting.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={secondary}
                      disabled={state.busy}
                      onClick={() => void state.remove(entry.name)}
                    >
                      Delete anyway
                    </button>
                    <button
                      type="button"
                      className={secondary}
                      disabled={state.busy}
                      onClick={() => state.setPendingDelete(null)}
                    >
                      Keep {singular}
                    </button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </TimelineScrollRegion>
      {editor && (
        <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-border bg-card px-6 py-4">
          <span className="mr-auto text-xs text-muted-foreground">
            {state.dirty ? 'Unsaved changes' : 'No changes yet'}
          </span>
          <button type="button" className={secondary} disabled={state.busy} onClick={() => state.setEditor(null)}>
            Cancel edit
          </button>
          <button type="submit" form="project-definition-editor" className={primary} disabled={state.busy}>
            Save {singular}
          </button>
        </footer>
      )}
    </aside>
  );
}
