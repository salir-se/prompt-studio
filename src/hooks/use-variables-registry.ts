/**
 * "Declare before use" variables registry (ADR-151/ADR-202 advisory posture): the registry state
 * seeded from `buildBuiltinRegistry()`, the per-project/per-root session-declaration persistence
 * (`<projectId>:<rootKey>` localStorage keys, with a one-shot migration shim for pre-project bare
 * keys), the rebuild-on-root/project-change, the declare write path the Variables drawer uses, and
 * the import-merge path — plus the registry-derived views (known variables, undeclared names, the
 * session-filtered verification result, the final-prompt preview text). Undeclared use is always a
 * visible FINDING and NEVER blocks editing or saving. Extracted verbatim from App.tsx.
 */

import { derivePromptVerificationState, PROMPT_PLACEHOLDER_RE } from '@prompt-studio/prompts';
import { useMemo, useState } from 'react';
import type { VerificationRunResult } from '../panels/VerificationPanel';
import type { ProjectDefinitions } from '../prompt-repo/project-definitions';
import { loadSessionDeclarations, saveSessionDeclarations } from '../registry/registry-persistence';
import {
  buildBuiltinRegistry,
  type DeclaredVariable,
  declareVariable,
  type DeclareVariableError,
  type DeclareVariableInput,
  undeclaredVariables,
  type VariablesRegistry,
} from '../registry/variables-registry';
import type { DocumentEditor } from './use-document-editor';
import type { HistoryBoot } from './use-history-boot';

/** The auto-created first project's slug — the project id the registry migration shim applies to. */
const DEFAULT_PROJECT_ID = 'default';

/**
 * Resolves every `{{name}}` placeholder in `text` that has a SESSION-declared sample, leaving every
 * other placeholder (built-in or undeclared) untouched — `FinalPromptPanel`'s own `buildSampleValues`/
 * `resolveVariablesForPreview` (scoped to the root's `editableKeys`) still runs on whatever text this
 * returns, so a built-in sample is never double-resolved and an already-substituted session value is
 * simply literal text by the time it gets there.
 */
export function resolveSessionSamplesForPreview(text: string, registry: VariablesRegistry): string {
  const sessionSamples: Record<string, string> = Object.create(null);
  for (const entry of registry.entries) {
    if (entry.source === 'session' && entry.sample !== '') sessionSamples[entry.name] = entry.sample;
  }
  if (Object.keys(sessionSamples).length === 0) return text;
  const placeholderRe = new RegExp(PROMPT_PLACEHOLDER_RE.source, PROMPT_PLACEHOLDER_RE.flags);
  return text.replace(placeholderRe, (match, name: string) =>
    Object.hasOwn(sessionSamples, name) ? sessionSamples[name] : match,
  );
}

/**
 * Drops `known-placeholder` findings whose subject is now a SESSION-declared variable — the
 * verification-side half of "declare before use". Deliberately scoped to session-sourced names only
 * (never the full builtin registry): `runRootVerification` already scopes its own `knownVariables` to
 * the root's editable keys, and blanket-suppressing every builtin name here would hide a legitimate
 * "not known for THIS root" warning for a builtin variable that belongs to a different prompt key.
 * `VerificationPanel.tsx` is out of scope for this change (see its module doc / `PromptVerificationRunOptions`
 * for the "real" mechanism this stands in for) — see App.tsx's module doc.
 */
export function filterDeclaredKnownPlaceholderFindings(
  result: VerificationRunResult | null,
  registry: VariablesRegistry,
): VerificationRunResult | null {
  if (!result) return result;
  const sessionNames = new Set(
    registry.entries.filter((entry) => entry.source === 'session').map((entry) => entry.name),
  );
  if (sessionNames.size === 0) return result;
  const findings = result.findings.filter(
    (finding) =>
      !(
        finding.source === 'deterministic' &&
        finding.ruleId === 'known-placeholder' &&
        finding.subject &&
        sessionNames.has(finding.subject)
      ),
  );
  const state = derivePromptVerificationState('not-run', findings);
  return { ...result, findings, state };
}

export function useVariablesRegistry({
  boot,
  editor,
  projectDefinitions,
}: {
  boot: HistoryBoot;
  editor: DocumentEditor;
  projectDefinitions?: ProjectDefinitions;
}) {
  const { doc, model, verificationResult, selectedRoot, selectedRootId } = editor;
  const { history } = boot;
  const [legacyRegistry, setRegistry] = useState<VariablesRegistry>(() => buildBuiltinRegistry());
  const registry = useMemo<VariablesRegistry>(
    () =>
      projectDefinitions
        ? { entries: projectDefinitions.variables.map((variable) => ({ ...variable, source: 'session' as const })) }
        : legacyRegistry,
    [projectDefinitions, legacyRegistry],
  );

  /**
   * The localStorage key session declarations persist under (ADR-203: registry persistence is
   * per-project): `<projectId>:<rootKey>` once the provider booted, the bare pre-project `rootKey`
   * while it hasn't — the key SHAPE stays v1 either way (`registry-persistence.ts` just prefixes it).
   */
  function scopedRegistryKey(rootKey: string): string {
    return history ? `${history.activeProjectId}:${rootKey}` : rootKey;
  }

  /** Load-side counterpart of `scopedRegistryKey` — see `rebuildForRoot` for the caller. */
  function loadScopedDeclarations(projectId: string | null, rootKey: string): readonly DeclaredVariable[] {
    if (projectId === null) return loadSessionDeclarations(rootKey);
    const scoped = loadSessionDeclarations(`${projectId}:${rootKey}`);
    if (scoped.length > 0 || projectId !== DEFAULT_PROJECT_ID) return scoped;
    // Migration shim for pre-project declarations: a Default-project load that finds nothing falls
    // back to the old bare `rootKey` entry once, so declarations saved before ADR-203 still appear.
    return loadSessionDeclarations(rootKey);
  }

  /**
   * Rebuilds the registry for a newly selected root (or newly active project): builtins re-derive
   * fresh, then the root's saved SESSION declarations (per-project localStorage — see
   * `registry-persistence.ts` and `loadScopedDeclarations`) fold back in through the same
   * `declareVariable` write path the UI uses, so a stale cached entry the validator now rejects is
   * silently skipped instead of crashing the load.
   */
  function rebuildForRoot(rootKey: string, projectId: string | null): void {
    let next = buildBuiltinRegistry();
    for (const saved of loadScopedDeclarations(projectId, rootKey)) {
      const result = declareVariable(next, saved);
      if (!('error' in result)) next = result;
    }
    setRegistry(next);
  }

  /**
   * Declares a session variable — the single registry write path (see App.tsx's module doc) — and
   * persists the session half per-root so the declaration survives a reload.
   */
  function declare(input: DeclareVariableInput): DeclareVariableError | undefined {
    const result = declareVariable(registry, input);
    if ('error' in result) return result;
    setRegistry(result);
    if (selectedRootId) saveSessionDeclarations(scopedRegistryKey(selectedRootId), result.entries);
    return undefined;
  }

  /**
   * Merges an imported blueprint's SESSION variables through `declareVariable` (an
   * already-declared name is simply skipped — the local declaration wins, duplicates are fine to
   * skip) and persists the session half under `rootKey`'s scoped key.
   */
  function mergeSessionVariables(variables: readonly DeclareVariableInput[], rootKey: string): void {
    let nextRegistry = registry;
    for (const variable of variables) {
      const result = declareVariable(nextRegistry, variable);
      if (!('error' in result)) nextRegistry = result;
    }
    setRegistry(nextRegistry);
    saveSessionDeclarations(scopedRegistryKey(rootKey), nextRegistry.entries);
  }

  const knownVariables = useMemo(() => {
    const fromModel = model.nodes.filter((node) => node.kind === 'variable').map((node) => node.label);
    const fromRegistry = registry.entries.map((entry) => entry.name);
    return [...new Set([...fromModel, ...fromRegistry])];
  }, [model, registry]);

  // Undeclared-use finding for the CURRENT document — never a save/edit gate, see module doc.
  const designVariables = selectedRoot?.design?.variables;
  const undeclaredNames = useMemo(
    () =>
      doc
        ? undeclaredVariables(
            registry,
            doc.text,
            designVariables?.map((variable) => variable.name),
          )
        : [],
    [doc, registry, designVariables],
  );

  const displayedVerificationResult = useMemo(
    () => filterDeclaredKnownPlaceholderFindings(verificationResult, registry),
    [verificationResult, registry],
  );

  const finalPromptText = useMemo(
    () => (doc ? resolveSessionSamplesForPreview(doc.text, registry) : ''),
    [doc, registry],
  );

  return {
    registry,
    knownVariables,
    undeclaredNames,
    displayedVerificationResult,
    finalPromptText,
    declare,
    rebuildForRoot,
    mergeSessionVariables,
  };
}

export type VariablesRegistryApi = ReturnType<typeof useVariablesRegistry>;
