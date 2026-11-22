import { HighlightedTokenSpans, MarkdownWithMermaid } from '@prompt-studio/prompt-graph-ui';
import { PROMPT_PLACEHOLDER_RE, PROMPT_VARIABLE_DOCS, tokenizePromptText } from '@prompt-studio/prompts';
import { TimelineScrollRegion } from '@prompt-studio/ui/timeline-scroll-region';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CatalogRoot } from '../catalog/root-catalog';
import { CloseButton } from '../components/CloseButton';
import { promptMetrics } from '../prompt-metrics';
import { requestCompactInterpretation } from './semantic-verification-client';

/**
 * Final-prompt preview drawer: resolves every `{{variable}}` in the CURRENT (possibly edited)
 * document text against sample values, then appends each protected skill's `SKILL.md` body under a
 * clearly-marked divider — full disclosure, no hidden content, because this is a developer tool.
 *
 * This is deliberately NOT what ships to the LLM at runtime (no real ICP/company data, sample values
 * only) — the amber banner below says so.
 */

const SKILLS_BRIDGE_ROOT = 'packages/skills/skills';
const STUDIO_TOKEN_HEADER = 'x-studio-token';

type CompactStatus = 'idle' | 'loading' | 'results' | 'unavailable' | 'budget-exhausted' | 'failed';

interface CompactState {
  readonly status: CompactStatus;
  readonly text: string;
  readonly model: string | null;
}

const IDLE_COMPACT_STATE: CompactState = { status: 'idle', text: '', model: null };

/**
 * Union of every variable-doc sample for the given editable keys, keyed by variable name.
 * Later keys win on a name collision (same convention as `variable-docs.ts`'s own `mergeVariableDocs`),
 * so e.g. researcher's TARGET `company_name` overrides an earlier brand `company_name` if both keys
 * are in play for one root — matching what the runtime would actually resolve last.
 */
export function buildSampleValues(editableKeys: readonly string[]): Record<string, string> {
  const samples: Record<string, string> = Object.create(null);
  for (const key of editableKeys) {
    if (!Object.hasOwn(PROMPT_VARIABLE_DOCS, key)) continue;
    const doc = PROMPT_VARIABLE_DOCS[key];
    if (!doc) continue;
    for (const variable of doc.variables) {
      samples[variable.key] = variable.sample;
    }
  }
  return samples;
}

/**
 * Resolves every `{{name}}` placeholder found in `text` that has a known sample value; anything NOT
 * in `sampleValues` is left as its literal `{{name}}` text rather than blanked. This deliberately
 * differs from `renderPrompt` (which silently substitutes `''` for an unknown key) — a developer
 * previewing the final prompt needs to SEE which placeholders are unresolved, not have them vanish.
 */
export function resolveVariablesForPreview(text: string, sampleValues: Readonly<Record<string, string>>): string {
  const re = new RegExp(PROMPT_PLACEHOLDER_RE.source, PROMPT_PLACEHOLDER_RE.flags);
  return text.replace(re, (match, key: string) => (Object.hasOwn(sampleValues, key) ? sampleValues[key] : match));
}

function skillDivider(name: string): string {
  return `\n\n── injected skill: ${name} ──\n\n`;
}

/** Visible, never-thrown fallback marker for a skill body the bridge could not supply. */
export function skillUnavailableMarker(name: string): string {
  return `[skill body unavailable: ${name}]`;
}

async function readStudioToken(): Promise<string | null> {
  if (typeof document === 'undefined') return null;
  return document.querySelector('meta[name="studio-token"]')?.getAttribute('content') ?? null;
}

/**
 * Fetches `packages/skills/skills/<name>/SKILL.md` through the studio's read-only fs bridge
 * (`../bridge/fs-bridge.ts`). Never throws: a missing token, no bridge (e.g. under vitest, where
 * there is no dev server at all), a network failure, or a non-2xx response all degrade to a visible
 * `[skill body unavailable: <name>]` marker instead.
 */
export async function fetchSkillBody(name: string): Promise<string> {
  try {
    if (typeof fetch !== 'function') throw new Error('fetch is not available in this environment');
    const token = await readStudioToken();
    if (!token) throw new Error('no studio-token meta tag found');
    const path = `${SKILLS_BRIDGE_ROOT}/${name}/SKILL.md`;
    const response = await fetch(`/__studio/file?path=${encodeURIComponent(path)}`, {
      headers: { [STUDIO_TOKEN_HEADER]: token },
    });
    if (!response.ok) throw new Error(`bridge responded with ${response.status}`);
    const body = (await response.json()) as { ok?: boolean; text?: string };
    if (!body.ok || typeof body.text !== 'string') throw new Error('bridge response missing file text');
    return body.text;
  } catch {
    return skillUnavailableMarker(name);
  }
}

export interface FinalPromptPanelProps {
  root: CatalogRoot;
  /** The CURRENT (post-edit) document text — never the catalog's pristine copy. */
  text: string;
  /** Sample-resolved text for the preview; source always uses text unchanged. */
  previewText?: string;
  /**
   * Per-configuration skill selection (ADR-235 / PS-009): the skills this configuration mounts for
   * the loaded document's agent. When `undefined`, the shipped `root.protectedSkills` governs
   * (identical to the pre-selection behavior); the chips below toggle this list per agent.
   */
  injectedSkills?: readonly string[];
  /** Every skill available to mount (the studio's loaded skill documents). */
  availableSkills?: readonly string[];
  /** Toggle one skill for the current agent — persists per configuration in the App. */
  onToggleSkill?: (name: string) => void;
  onClose: () => void;
}

/** Top-bar "Final prompt" drawer. */
export function FinalPromptPanel({
  root,
  text,
  previewText = text,
  injectedSkills,
  availableSkills,
  onToggleSkill,
  onClose,
}: FinalPromptPanelProps): React.JSX.Element {
  const [showSource, setShowSource] = useState(false);
  const [skillBodies, setSkillBodies] = useState<Record<string, string>>({});
  const [compact, setCompact] = useState<CompactState>(IDLE_COMPACT_STATE);
  const [copied, setCopied] = useState(false);
  const compactRequestId = useRef(0);

  const sampleValues = useMemo(() => buildSampleValues(root.entry.editableKeys), [root]);
  const resolvedText = useMemo(
    () => resolveVariablesForPreview(previewText, sampleValues),
    [previewText, sampleValues],
  );

  const mountedSkills = injectedSkills ?? root.protectedSkills;

  useEffect(() => {
    let cancelled = false;
    setSkillBodies({});
    void Promise.all(mountedSkills.map(async (name) => [name, await fetchSkillBody(name)] as const)).then((entries) => {
      if (!cancelled) setSkillBodies(Object.fromEntries(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [mountedSkills]);

  const finalText = useMemo(() => {
    const injected = mountedSkills
      .map((name) => skillDivider(name) + (skillBodies[name] ?? skillUnavailableMarker(name)))
      .join('');
    return resolvedText + injected;
  }, [resolvedText, mountedSkills, skillBodies]);
  const finalMetrics = useMemo(() => promptMetrics(finalText), [finalText]);
  const displayedMetrics = showSource ? promptMetrics(text) : finalMetrics;
  const compactMetrics = useMemo(() => promptMetrics(compact.text), [compact.text]);
  const skillsLoaded = mountedSkills.every((name) => skillBodies[name] !== undefined);
  const compactInputKey = `${root.id}\u0000${finalText}`;

  useEffect(() => {
    if (!compactInputKey) return;
    compactRequestId.current += 1;
    setCompact(IDLE_COMPACT_STATE);
    setCopied(false);
  }, [compactInputKey]);

  useEffect(
    () => () => {
      compactRequestId.current += 1;
    },
    [],
  );

  async function runCompactInterpretation(): Promise<void> {
    const requestId = ++compactRequestId.current;
    setCompact({ status: 'loading', text: '', model: null });
    setCopied(false);
    const outcome = await requestCompactInterpretation(root.id, finalText);
    if (requestId !== compactRequestId.current) return;
    if (outcome.kind === 'ok') {
      setCompact({ status: 'results', text: outcome.compactText, model: outcome.model });
    } else {
      setCompact({ status: outcome.kind, text: '', model: null });
    }
  }

  async function copyCompactInterpretation(): Promise<void> {
    try {
      await navigator.clipboard.writeText(compact.text);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  // The source view is byte-for-byte prompt Markdown, not the sample-resolved preview. Known
  // variables still receive normal highlighting; undeclared placeholders remain amber.
  const sourceTokens = useMemo(
    () =>
      tokenizePromptText(text, {
        variables: root.design?.variables.map((variable) => variable.name) ?? [],
        tools: root.toolNames,
      }),
    [text, root.design?.variables, root.toolNames],
  );

  return (
    <aside
      aria-label="Final prompt"
      data-testid="final-prompt-drawer"
      className="fixed inset-y-0 right-0 z-40 flex flex-col border-l border-border bg-card shadow-xl"
      style={{ width: 'min(560px, 100vw)' }}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-4 py-2">
        <h2 className="truncate text-sm font-semibold">Final prompt — {root.title}</h2>
        <div className="flex shrink-0 items-center gap-2">
          <CloseButton onClick={onClose} />
        </div>
      </header>
      {availableSkills !== undefined && onToggleSkill !== undefined && injectedSkills !== undefined && (
        <section
          aria-label="Skills mounted for this agent"
          className="flex shrink-0 flex-col gap-1.5 border-b border-border px-4 py-2"
        >
          <p className="text-[11px] text-muted-foreground">
            Skills mounted for this agent in this configuration (toggle to change — preview updates; the shipped default
            applies until you toggle).
          </p>
          <div className="flex flex-wrap gap-1.5" data-testid="final-prompt-skill-chips">
            {availableSkills.map((name) => {
              const mounted = injectedSkills.includes(name);
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={mounted}
                  aria-label={`${mounted ? 'Unmount' : 'Mount'} skill ${name}`}
                  className={`rounded-full border px-2 py-0.5 text-[11px] transition-colors ${
                    mounted
                      ? 'border-primary bg-primary/10 font-medium text-primary'
                      : 'border-border text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={() => onToggleSkill(name)}
                >
                  {name}
                </button>
              );
            })}
          </div>
        </section>
      )}

      <fieldset
        aria-label="Prompt representation"
        className="flex shrink-0 gap-1 border-b border-border bg-muted/20 px-4 py-3"
      >
        <button
          type="button"
          data-testid="final-prompt-source-toggle"
          aria-pressed={showSource}
          onClick={() => setShowSource(true)}
          className={`rounded-md px-3 py-2 text-xs font-medium ${showSource ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
        >
          Source Markdown
        </button>
        <button
          type="button"
          aria-pressed={!showSource}
          onClick={() => setShowSource(false)}
          className={`rounded-md px-3 py-2 text-xs font-medium ${!showSource ? 'bg-primary text-primary-foreground' : 'hover:bg-muted'}`}
        >
          Sample preview
        </button>
      </fieldset>
      <p
        role="note"
        data-testid="final-prompt-banner"
        className={
          showSource
            ? 'shrink-0 border-b border-border bg-muted/30 px-4 py-1.5 text-xs text-muted-foreground'
            : 'shrink-0 border-b border-amber-300 bg-amber-100/70 px-4 py-1.5 text-xs text-amber-900 dark:border-amber-800 dark:bg-amber-900/40 dark:text-amber-200'
        }
      >
        {showSource
          ? 'Canonical prompt Markdown — graph structure and instructions are derived from this text.'
          : 'Sample values + injected skill bodies — developer preview, never ship this text.'}
      </p>
      {root.design !== undefined && (
        <section
          aria-label="Prompt and verification artifacts"
          data-testid="final-prompt-artifact-boundary"
          className="grid shrink-0 gap-2 border-b border-border bg-muted/30 px-4 py-2 text-[11px] leading-4 sm:grid-cols-2"
        >
          <p>
            <strong className="text-foreground">Prompt Markdown</strong>
            <br />
            The source of truth for instructions and graph structure. Runtime values and mounted skills resolve later.
          </p>
          <p>
            <strong className="text-foreground">Verification sidecar</strong>
            <br />
            Input, Workflow, Output, schemas, examples, rules, and principles. Checked separately; not added to model
            instructions automatically.
          </p>
        </section>
      )}
      <div
        data-testid="final-prompt-metrics"
        className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-b border-border px-4 py-2 text-[11px] text-muted-foreground"
      >
        <span>{displayedMetrics.characters.toLocaleString()} characters</span>
        <span>{displayedMetrics.bytes.toLocaleString()} UTF-8 bytes</span>
        <span title="Estimate only: roughly four UTF-8 bytes per token; actual usage depends on the selected provider and model.">
          ≈{displayedMetrics.estimatedTokens.toLocaleString()} tokens
        </span>
      </div>
      <TimelineScrollRegion className="min-h-0 flex-1" viewportClassName="p-4">
        <div>
          {showSource ? (
            <pre data-testid="final-prompt-raw" className="whitespace-pre-wrap break-words font-mono text-xs">
              <HighlightedTokenSpans tokens={sourceTokens} />
            </pre>
          ) : (
            <MarkdownWithMermaid text={finalText} />
          )}
        </div>
        <section aria-label="Compact interpretation" className="mt-6 rounded-md border border-border bg-muted/30 p-3">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h3 className="text-xs font-semibold">Compact interpretation (AI)</h3>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Read-only check of how the model can restate the assembled prompt. It never changes the source.
              </p>
            </div>
            <button
              type="button"
              data-testid="compact-interpretation-run"
              disabled={!skillsLoaded || compact.status === 'loading'}
              title={skillsLoaded ? undefined : 'Waiting for mounted skill bodies.'}
              onClick={() => void runCompactInterpretation()}
              className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
            >
              {compact.status === 'loading' ? 'Interpreting…' : 'Run compact check'}
            </button>
          </div>
          {compact.status === 'unavailable' && (
            <p className="mt-2 text-xs text-muted-foreground">AI verification is unavailable in this environment.</p>
          )}
          {compact.status === 'budget-exhausted' && (
            <p className="mt-2 text-xs text-muted-foreground">
              The AI verification budget is exhausted for this session.
            </p>
          )}
          {compact.status === 'failed' && (
            <p className="mt-2 text-xs text-destructive">
              The compact interpretation failed. The prompt was not changed.
            </p>
          )}
          {compact.status === 'results' && (
            <div className="mt-3 space-y-2">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p data-testid="compact-interpretation-comparison" className="text-[11px] text-muted-foreground">
                  {finalMetrics.estimatedTokens.toLocaleString()} → {compactMetrics.estimatedTokens.toLocaleString()}{' '}
                  estimated tokens (
                  {finalMetrics.estimatedTokens >= compactMetrics.estimatedTokens
                    ? `${finalMetrics.estimatedTokens - compactMetrics.estimatedTokens} fewer`
                    : `${compactMetrics.estimatedTokens - finalMetrics.estimatedTokens} more`}
                  )
                </p>
                <button
                  type="button"
                  onClick={() => void copyCompactInterpretation()}
                  className="rounded-md border border-border px-2 py-1 text-xs hover:bg-muted"
                >
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <pre
                data-testid="compact-interpretation-result"
                className="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background p-2 font-mono text-xs"
              >
                {compact.text}
              </pre>
              <p className="text-[10px] text-muted-foreground">Model: {compact.model}</p>
            </div>
          )}
        </section>
      </TimelineScrollRegion>
    </aside>
  );
}
