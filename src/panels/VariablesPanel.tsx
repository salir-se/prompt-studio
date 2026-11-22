import { PROMPT_VARIABLE_DOCS, type PromptKeyVariableDocs } from '@prompt-studio/prompts';
import { TimelineScrollRegion } from '@prompt-studio/ui/timeline-scroll-region';
import { useState } from 'react';
import { CloseButton } from '../components/CloseButton';
import type { DeclareVariableError, DeclareVariableInput, VariablesRegistry } from '../registry/variables-registry';

/**
 * Variables directory drawer — flattens `PROMPT_VARIABLE_DOCS` (keyed by prompt key) into one row per
 * distinct `{{variable}}` name, listing every prompt key that declares it. This app only declares
 * `@prompt-studio/prompt-graph-ui`/`@prompt-studio/prompts` (plus `mermaid`) — see `App.tsx`'s module doc — so, like
 * `App.tsx`, this file styles plain elements with local Tailwind classes instead of importing
 * `@prompt-studio/ui`.
 *
 * "Declare before use" registry (design brief: user declares a variable + its purpose before any
 * prompt may use it) — this drawer is also where a SESSION variable gets declared. `App.tsx` owns the
 * `VariablesRegistry` state; this component is a pure, prop-driven form over `onDeclare` plus an
 * "Undeclared in current prompt" section surfacing `undeclaredNames` (from `undeclaredVariables()`)
 * with a one-click prefill into the form. Session-scoped only for now — see `variables-registry.ts`'s
 * module doc for the ADR-200/ADR-202 lineage this precedes.
 */

export interface FlattenedVariable {
  readonly key: string;
  readonly label: string;
  readonly sample: string;
  readonly required: boolean;
  readonly promptKeys: readonly string[];
}

/**
 * Groups every prompt key's variable docs by variable `key`, merging the declaring prompt keys. A
 * variable name can carry a different meaning per prompt key (e.g. `company_name` is YOUR brand name
 * to most keys but the PROSPECT's name to `researcher`/`closer`) — this flattening keeps the
 * first-declared label/sample as the documented meaning (insertion order of `PROMPT_VARIABLE_DOCS`)
 * and only merges the *set of prompt keys* that reference it, never silently picking a "better" one.
 */
export function flattenVariableDocs(
  docs: Readonly<Record<string, PromptKeyVariableDocs>> = PROMPT_VARIABLE_DOCS,
): readonly FlattenedVariable[] {
  const byKey = new Map<string, { label: string; sample: string; required: boolean; promptKeys: Set<string> }>();

  for (const [promptKey, doc] of Object.entries(docs)) {
    for (const variable of doc.variables) {
      const existing = byKey.get(variable.key);
      if (existing) {
        existing.promptKeys.add(promptKey);
        continue;
      }
      byKey.set(variable.key, {
        label: variable.label,
        sample: variable.sample,
        required: variable.required ?? true,
        promptKeys: new Set([promptKey]),
      });
    }
  }

  return [...byKey.entries()]
    .map(([key, entry]): FlattenedVariable => ({
      key,
      label: entry.label,
      sample: entry.sample,
      required: entry.required,
      promptKeys: [...entry.promptKeys].sort(),
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
}

const VIOLET_CHIP_CLASSES = 'bg-violet-100/70 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300';
const SKY_CHIP_CLASSES = 'bg-sky-100/70 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300';
const EMERALD_CHIP_CLASSES = 'bg-emerald-100/70 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300';
const MUTED_CHIP_CLASSES = 'bg-muted text-muted-foreground';
const CHIP_BASE_CLASSES = 'inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 font-mono text-xs';

const AMBER_CHIP_CLASSES = 'bg-amber-100/70 text-amber-800 dark:bg-amber-900/50 dark:text-amber-300';

const INPUT_CLASSES =
  'w-full rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring';

interface DeclareFormState {
  name: string;
  purpose: string;
  sample: string;
  required: boolean;
}

const EMPTY_FORM: DeclareFormState = { name: '', purpose: '', sample: '', required: true };

export interface VariablesPanelProps {
  onClose: () => void;
  usedVariableNames?: readonly string[];
  /** Current session + built-in registry — omitted (e.g. bare unit tests) simply shows no session entries. */
  registry?: VariablesRegistry;
  /** Declares a session variable; returns `{ error }` on the three validation failures, `undefined` on success. */
  onDeclare?: (input: DeclareVariableInput) => DeclareVariableError | undefined;
  /** Placeholder names used in the current document that are declared nowhere — from `undeclaredVariables()`. */
  undeclaredNames?: readonly string[];
}

/**
 * Top-bar "Variables" drawer: a "declare before use" form, an "Undeclared in current prompt" finding
 * section (never a save-blocking gate — see module doc), the session-declared list, and every known
 * built-in `{{variable}}` with its description, sample, and declaring keys.
 */
export function VariablesPanel({
  onClose,
  usedVariableNames,
  registry,
  onDeclare,
  undeclaredNames = [],
}: VariablesPanelProps): React.JSX.Element {
  const variables = flattenVariableDocs();
  const sessionEntries = registry?.entries.filter((entry) => entry.source === 'session') ?? [];

  const [query, setQuery] = useState('');
  const [usedOnly, setUsedOnly] = useState(false);
  const search = query.trim().toLowerCase();
  const visibleVariables = variables.filter(
    (variable) =>
      (!usedOnly || usedVariableNames?.includes(variable.key)) &&
      [variable.key, variable.label, ...variable.promptKeys].join(' ').toLowerCase().includes(search),
  );
  const visibleSessionEntries = sessionEntries.filter(
    (entry) =>
      (!usedOnly || usedVariableNames?.includes(entry.name)) &&
      [entry.name, entry.purpose].join(' ').toLowerCase().includes(search),
  );

  const [form, setForm] = useState<DeclareFormState>({ ...EMPTY_FORM });
  const [formError, setFormError] = useState<string | null>(null);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const input: DeclareVariableInput = {
      name: form.name,
      purpose: form.purpose,
      sample: form.sample || undefined,
      required: form.required,
    };
    const result = onDeclare?.(input);
    if (result && 'error' in result) {
      setFormError(result.error);
      return;
    }
    setFormError(null);
    setForm({ ...EMPTY_FORM });
  }

  /**
   * Prefills the (already-mounted) declare form's Name field from a row's "Declare…" click — a plain
   * `setForm` on this component's own state, not a prop from `App.tsx`: the drawer is never remounted
   * between opening it and clicking a row, so the controlled `<input value={form.name}>` picks this up
   * on the very next render. Verified end-to-end (status-bar chip → row click → real `input.value`
   * assertion) in `App.test.tsx`.
   */
  function handlePrefill(name: string): void {
    setForm((prev) => ({ ...prev, name }));
    setFormError(null);
  }

  return (
    <aside
      aria-label="Variables"
      data-testid="variables-drawer"
      className="fixed inset-y-0 right-0 z-40 flex w-[560px] max-w-full flex-col border-l border-border bg-card shadow-xl"
    >
      <header className="flex shrink-0 items-center justify-between border-b border-border px-4 py-2">
        <h2 className="text-sm font-semibold">
          Variables <span className="font-normal text-muted-foreground">({variables.length})</span>
        </h2>
        <CloseButton onClick={onClose} />
      </header>
      <div className="space-y-3 border-b border-border bg-muted/20 px-4 py-3">
        <p className="text-xs leading-5 text-muted-foreground">
          Runtime variable reference and declarations for this session. Project definitions are managed separately.
        </p>
        <label className="block text-xs font-medium">
          Find a variable
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, purpose or agent"
            className="mt-1 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
          />
        </label>
        {usedVariableNames !== undefined && (
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={usedOnly} onChange={(event) => setUsedOnly(event.target.checked)} />
            Used by selected prompt
          </label>
        )}
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span role="status">
            {visibleVariables.length + visibleSessionEntries.length} of {variables.length + sessionEntries.length}{' '}
            variables
          </span>
          {(query || usedOnly) && (
            <button
              type="button"
              className="text-foreground underline"
              onClick={() => {
                setQuery('');
                setUsedOnly(false);
              }}
            >
              Clear filter
            </button>
          )}
        </div>
      </div>
      <TimelineScrollRegion className="min-h-0 flex-1" viewportClassName="flex flex-col gap-3 p-4">
        {undeclaredNames.length > 0 && (
          <section
            data-testid="undeclared-section"
            aria-label="Undeclared in current prompt"
            className="flex flex-col gap-1.5 rounded-lg border border-destructive/40 bg-destructive/5 p-2.5 text-xs"
          >
            <h3 className="font-semibold text-destructive">
              Undeclared in current prompt <span className="font-normal">({undeclaredNames.length})</span>
            </h3>
            <ul className="flex flex-col gap-1">
              {undeclaredNames.map((name) => (
                <li key={name} data-testid="undeclared-row" className="flex items-center justify-between gap-2">
                  <span className={`${CHIP_BASE_CLASSES} ${AMBER_CHIP_CLASSES}`}>{`{{${name}}}`}</span>
                  {/* Distinct accessible name from the form's submit button below (`Declare variable`) —
                      both used to read as "Declare…"/"Declare", which a substring accessible-name match
                      (e.g. Playwright's `getByRole('button', { name: 'Declare' })`) cannot disambiguate. */}
                  <button
                    type="button"
                    aria-label={`Declare {{${name}}}…`}
                    onClick={() => handlePrefill(name)}
                    className="rounded-md border border-border px-2 py-0.5 text-xs hover:bg-muted"
                  >
                    Declare…
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}

        <form
          data-testid="declare-variable-form"
          onSubmit={handleSubmit}
          className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-2.5 text-xs"
        >
          <h3 className="font-semibold text-foreground">Declare variable</h3>
          <label className="flex flex-col gap-0.5">
            <span className="text-muted-foreground">Name</span>
            <input
              aria-label="Variable name"
              className={`${INPUT_CLASSES} font-mono`}
              placeholder="my_variable"
              value={form.name}
              onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-muted-foreground">Purpose</span>
            <input
              aria-label="Purpose"
              className={INPUT_CLASSES}
              placeholder="Why the prompt needs this variable"
              value={form.purpose}
              onChange={(event) => setForm((prev) => ({ ...prev, purpose: event.target.value }))}
            />
          </label>
          <label className="flex flex-col gap-0.5">
            <span className="text-muted-foreground">Sample</span>
            <input
              aria-label="Sample value"
              className={INPUT_CLASSES}
              placeholder="Example value shown in the final-prompt preview"
              value={form.sample}
              onChange={(event) => setForm((prev) => ({ ...prev, sample: event.target.value }))}
            />
          </label>
          <label className="flex items-center gap-1.5 text-foreground">
            <input
              type="checkbox"
              aria-label="Required"
              checked={form.required}
              onChange={(event) => setForm((prev) => ({ ...prev, required: event.target.checked }))}
            />
            Required
          </label>
          {formError && (
            <p role="alert" data-testid="declare-variable-error" className="text-destructive">
              {formError}
            </p>
          )}
          <button
            type="submit"
            aria-label="Declare variable"
            className="w-fit rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Declare
          </button>
          <p className="text-muted-foreground">
            Available in this browser session and included in the developer ZIP. This does not create a project
            definition.
          </p>
        </form>

        {visibleSessionEntries.length > 0 && (
          <div className="flex flex-col gap-2">
            {visibleSessionEntries.map((entry) => (
              <article
                key={entry.name}
                aria-label={entry.name}
                data-testid="session-variable-row"
                className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-2.5 text-xs"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={`${CHIP_BASE_CLASSES} ${VIOLET_CHIP_CLASSES}`}>{`{{${entry.name}}}`}</span>
                  <span
                    className={`${CHIP_BASE_CLASSES} bg-sky-100/70 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300`}
                  >
                    session
                  </span>
                </div>
                <p className="text-foreground">{entry.purpose}</p>
                {entry.sample && (
                  <p className="truncate text-muted-foreground" title={entry.sample}>
                    sample: {entry.sample}
                  </p>
                )}
              </article>
            ))}
          </div>
        )}

        {visibleVariables.length + visibleSessionEntries.length === 0 && (
          <p className="text-sm text-muted-foreground">No variables match these filters.</p>
        )}
        {visibleVariables.map((variable) => (
          <article
            key={variable.key}
            aria-label={variable.key}
            data-testid="variable-directory-row"
            className="flex flex-col gap-1.5 rounded-lg border border-border bg-background p-2.5 text-xs"
          >
            <div className="flex items-center justify-between gap-2">
              <span className={`${CHIP_BASE_CLASSES} ${VIOLET_CHIP_CLASSES}`}>{`{{${variable.key}}}`}</span>
              <span className={`${CHIP_BASE_CLASSES} ${variable.required ? EMERALD_CHIP_CLASSES : MUTED_CHIP_CLASSES}`}>
                {variable.required ? 'required' : 'optional'}
              </span>
            </div>
            <p className="text-foreground">{variable.label}</p>
            <p className="truncate text-muted-foreground" title={variable.sample}>
              sample: {variable.sample}
            </p>
            <div className="flex flex-wrap gap-1">
              {variable.promptKeys.map((promptKey) => (
                <span key={promptKey} className={`${CHIP_BASE_CLASSES} ${SKY_CHIP_CLASSES}`}>
                  {promptKey}
                </span>
              ))}
            </div>
          </article>
        ))}
      </TimelineScrollRegion>
    </aside>
  );
}
