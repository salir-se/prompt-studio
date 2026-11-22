import type { SectionVerificationCoverage } from '@prompt-studio/prompt-graph-ui';
import type { PromptDesign, PromptVerificationFinding } from '@prompt-studio/prompts';
import { Badge } from '@prompt-studio/ui/badge';
import { Button } from '@prompt-studio/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@prompt-studio/ui/tabs';
import { useEffect, useState } from 'react';
import type { CatalogRoot } from '../catalog/root-catalog';
import { CloseButton } from '../components/CloseButton';
import type { VerificationTarget } from '../hooks/use-verification-workspace';
import { canVerifyRoot, type VerificationRunResult } from './root-verification';
import { SemanticReview } from './verification/SemanticReview';
import type { CheckProposal } from '../verification/check-proposals';
import { type ResolveProposal, VerificationChecksEditor } from './verification/VerificationChecksEditor';
import { VerificationFindings } from './verification/VerificationFindings';
import { VerificationSourceEditor } from './verification/VerificationSourceEditor';
import type { SemanticReviewSession } from './verification/use-semantic-review';
import { useSemanticReview } from './verification/use-semantic-review';
import { findingSourceRange, sortedFindings } from './verification/verification-display';
import { WHOLE_PROMPT } from './verification/verification-editing';

export {
  canVerifyRoot,
  primaryEditableKeyFor,
  runRootVerification,
  type VerificationRunResult,
  type VerificationSectionDependency,
  type VerificationSectionResult,
  verifyDisabledReason,
} from './root-verification';

export interface VerificationPanelProps {
  root: CatalogRoot;
  result: VerificationRunResult | null;
  text?: string;
  onClose: () => void;
  onRecheck?: (text?: string, design?: PromptDesign) => void;
  onSaveText?: (text: string) => Promise<void>;
  onSaveDesign?: (design: PromptDesign) => Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  target?: VerificationTarget;
  semanticSession?: SemanticReviewSession;
  executionPending?: boolean;
  coverage?: {
    byNodeId: Readonly<Record<string, SectionVerificationCoverage>>;
    wholePrompt: SectionVerificationCoverage;
  };
  onOpenTests?: () => void;
  onOpenSettings?: () => void;
  /** Checks an agent proposed for this prompt; shown in Checks & criteria until the person decides. */
  proposals?: readonly CheckProposal[];
  onResolveProposal?: ResolveProposal;
}

/** Review source and findings together; the editor retains persistence and verification ownership. */
export function VerificationPanel({
  root,
  result,
  text = result?.text ?? root.text ?? '',
  onClose,
  onRecheck,
  onSaveText,
  onSaveDesign,
  onDirtyChange,
  target: requestedTarget,
  semanticSession,
  executionPending,
  coverage,
  onOpenTests,
  onOpenSettings,
  proposals,
  onResolveProposal,
}: VerificationPanelProps) {
  const [scope, setScope] = useState(WHOLE_PROMPT);
  const [tab, setTab] = useState('findings');
  const [sourceDirty, setSourceDirty] = useState(false);
  const [checksDirty, setChecksDirty] = useState(false);
  const [target, setTarget] = useState<{ start: number; end: number; version: number; heading: string }>();
  const localSemantic = useSemanticReview(result);
  const semantic = semanticSession ?? localSemantic;
  useEffect(() => {
    if (requestedTarget) {
      setScope(requestedTarget.scope);
      setTab(requestedTarget.tab);
    }
  }, [requestedTarget]);
  const selected = result?.sections.find((section) =>
    scope === WHOLE_PROMPT
      ? section.sectionId === root.id && section.profile.scope !== 'section'
      : section.sectionId === scope,
  );
  const review = semantic.forSection(selected);
  const reviewLabels = {
    idle: 'not run',
    loading: 'reviewing…',
    results: `${review.findings.length} finding${review.findings.length === 1 ? '' : 's'} · reviewed`,
    unavailable: 'not configured',
    'budget-exhausted': 'review budget used',
    failed: 'could not complete',
    stale: 'saved prompt changed',
    busy: 'waiting for an available review slot',
  };
  const dirty = sourceDirty || checksDirty;
  useEffect(() => {
    onDirtyChange?.(dirty);
    return () => onDirtyChange?.(false);
  }, [dirty, onDirtyChange]);
  const sections = result?.sections.filter((section) => section.profile.scope === 'section') ?? [];
  const selectedScope =
    scope === WHOLE_PROMPT || sections.some((section) => section.sectionId === scope) ? scope : WHOLE_PROMPT;
  const findings = sortedFindings(
    result?.findings.filter(
      (finding) =>
        selectedScope === WHOLE_PROMPT || (finding.scope === 'section' && finding.sectionId === selectedScope),
    ) ?? [],
  );
  const errors = result?.findings.filter((finding) => finding.severity === 'error').length ?? 0;
  const warnings = result?.findings.filter((finding) => finding.severity === 'warning').length ?? 0;
  const ruleCount = result?.profiles.reduce((count, profile) => count + profile.deterministicRules.length, 0) ?? 0;
  const scopeName = (id?: string) =>
    result?.sections.find((section) => section.sectionId === id)?.heading ?? 'Whole prompt';
  function openSource(finding: PromptVerificationFinding) {
    setTarget({
      ...findingSourceRange(root, text, result, finding),
      version: Date.now(),
      heading: scopeName(finding.scope === 'section' ? finding.sectionId : undefined),
    });
  }
  return (
    <aside
      aria-label="Verify"
      data-testid="verification-drawer"
      onKeyDown={(event) => {
        if (event.target instanceof Element) {
          if (event.target.closest('textarea, input, select')) return;
          const overlay = event.target.closest('[role="dialog"], [role="menu"]');
          if (overlay && overlay !== event.currentTarget.closest('[role="dialog"]')) return;
        }
        if (
          tab === 'findings' &&
          !dirty &&
          onSaveText &&
          findings[0] &&
          (event.ctrlKey || event.metaKey) &&
          !event.altKey &&
          !event.nativeEvent.isComposing &&
          event.key === 'Enter'
        ) {
          event.preventDefault();
          event.stopPropagation();
          openSource(findings[0]);
        }
      }}
      className="fixed inset-y-0 right-0 z-40 flex w-full flex-col border-l border-border bg-card shadow-xl xl:w-[min(1200px,calc(100%-2rem))]"
    >
      <header className="flex shrink-0 flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
        <div className="min-w-0 flex-1">
          <h2 className="break-words text-base font-semibold">Verify · {root.title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">Inspect findings, adjust checks, and repair the source.</p>
        </div>
        <CloseButton onClick={onClose} />
      </header>
      <Tabs value={tab} onValueChange={setTab} className="block min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
        <div className="mb-4 flex flex-wrap items-end gap-3">
          <label className="min-w-0 text-xs font-medium">
            Review scope
            <select
              aria-label="Verification section"
              className="mt-1 block max-w-full rounded-md border border-input bg-background p-2 text-sm"
              value={selectedScope}
              disabled={!!checksDirty}
              onChange={(event) => setScope(event.target.value)}
            >
              <option value={WHOLE_PROMPT}>Whole prompt</option>
              {sections.map((section) => (
                <option key={section.sectionId} value={section.sectionId}>
                  {section.heading}
                </option>
              ))}
            </select>
          </label>
          <Button
            type="button"
            size="sm"
            disabled={!onRecheck || dirty || !canVerifyRoot(root)}
            onClick={() => onRecheck?.()}
          >
            Recheck prompt
          </Button>
          <p role="status" className="max-w-full break-words text-xs text-muted-foreground">
            {dirty
              ? 'Unsaved edits · save the source or check definitions before rechecking.'
              : result
                ? 'Automatic checks complete · AI review is separate.'
                : 'Checks have not run for the current source or check definitions.'}
          </p>
        </div>
        <TabsList aria-label="Verification views" className="mb-4 max-w-full shrink-0">
          <TabsTrigger value="findings">Findings · {findings.length}</TabsTrigger>
          <TabsTrigger value="checks">Checks &amp; criteria</TabsTrigger>
          <TabsTrigger value="ai">AI review</TabsTrigger>
        </TabsList>
        <section
          data-testid="verification-node"
          aria-label="Verification summary"
          className="mb-4 space-y-2 rounded-lg border border-border bg-muted/20 p-3"
        >
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold">Whole-prompt automatic result</h3>
            <Badge
              variant={errors ? 'destructive' : 'outline'}
              className={errors ? 'text-red-700 dark:text-red-300' : undefined}
            >
              {result
                ? errors
                  ? `${errors} error${errors === 1 ? '' : 's'}`
                  : warnings
                    ? `${warnings} warning${warnings === 1 ? '' : 's'}`
                    : ruleCount
                      ? 'No errors or warnings'
                      : 'No automatic checks configured'
                : 'Not checked'}
            </Badge>
          </div>
          {result && (
            <p className="text-sm">
              {errors} error{errors === 1 ? '' : 's'} · {warnings} warning{warnings === 1 ? '' : 's'} · {ruleCount}{' '}
              automatic checks configured
            </p>
          )}
          <p className="break-words text-xs text-muted-foreground">
            AI review for{' '}
            {selected?.heading ?? (selectedScope === WHOLE_PROMPT ? 'Whole prompt' : scopeName(selectedScope))}:{' '}
            {reviewLabels[review.status]}.
          </p>
          {result && (
            <details className="text-xs text-muted-foreground">
              <summary className="cursor-pointer">Result details</summary>
              <span data-testid="verification-node-state">{result.state}</span>
            </details>
          )}
        </section>
        {root.design && (
          <details aria-label="Verification harness" className="mb-4 rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm font-medium">Coverage &amp; requirements</summary>
            <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-semibold">
                  Requirements for {scopeName(selectedScope === WHOLE_PROMPT ? undefined : selectedScope)}
                </h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Add requirements around the existing instructions. Basic checks and generated Design criteria are
                  starting points.
                </p>
                {coverage &&
                  (() => {
                    const count =
                      selectedScope === WHOLE_PROMPT
                        ? coverage.wholePrompt
                        : Object.values(coverage.byNodeId).find((entry) => entry.sectionId === selectedScope);
                    return (
                      count && (
                        <p className="mt-1 text-xs">
                          {count.automatic.basic} basic · {count.automatic.custom} authored checks ·{' '}
                          {count.ai.generated} Design criteria · {count.ai.custom} authored AI criteria
                        </p>
                      )
                    );
                  })()}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setTab('checks')}>
                  Configure checks
                </Button>
                {onOpenTests && (
                  <Button type="button" variant="outline" onClick={onOpenTests}>
                    Whole-prompt evaluation tests
                  </Button>
                )}
              </div>
            </div>
          </details>
        )}
        <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <TabsContent value="findings" forceMount className="space-y-4 pt-3 data-[state=inactive]:hidden">
              <h3 className="text-sm font-semibold">
                Automatic findings · {scopeName(selectedScope === WHOLE_PROMPT ? undefined : selectedScope)}
              </h3>
              {onSaveText && !!findings.length && (
                <p className="text-xs text-muted-foreground">Ctrl / ⌘ + Enter opens the first finding in source.</p>
              )}
              {findings.length ? (
                <VerificationFindings
                  findings={findings}
                  scopeName={scopeName}
                  onOpen={onSaveText ? openSource : undefined}
                />
              ) : (
                <p className="text-sm text-muted-foreground">
                  {result
                    ? 'No automatic findings in this scope. AI review has its own results.'
                    : canVerifyRoot(root)
                      ? 'Recheck the current source to see findings.'
                      : 'No verification profile is available for this root.'}
                </p>
              )}
            </TabsContent>
            <TabsContent value="checks" forceMount className="pt-3 data-[state=inactive]:hidden">
              <VerificationChecksEditor
                profiles={result?.profiles ?? root.verification?.profiles ?? []}
                design={root.design}
                presetContext={{
                  text: selectedScope === WHOLE_PROMPT ? text : (selected?.text ?? ''),
                  knownVariables: root.design?.variables.map((variable) => variable.name) ?? [],
                  toolNames: root.design?.tools ?? root.toolNames ?? [],
                  outputContract:
                    selectedScope === WHOLE_PROMPT
                      ? root.design?.output
                      : root.design?.sectionDesigns.find((section) => section.sectionId === selectedScope)?.output,
                }}
                scope={selectedScope}
                proposals={proposals}
                onResolveProposal={onResolveProposal}
                disabled={sourceDirty}
                onSave={
                  onSaveDesign
                    ? async (design) => {
                        await onSaveDesign(design);
                        onRecheck?.(undefined, design);
                      }
                    : undefined
                }
                onDirtyChange={setChecksDirty}
              />
            </TabsContent>
            <TabsContent value="ai" forceMount className="pt-3 data-[state=inactive]:hidden">
              <SemanticReview
                review={review}
                section={selected}
                busy={semantic.busy}
                disabled={!result || dirty || !!executionPending}
                pending={executionPending}
                onSettings={onOpenSettings}
                onRun={() => {
                  if (selected) void semantic.run(selected);
                }}
                onOpen={onSaveText ? openSource : undefined}
                scopeName={scopeName}
              />
            </TabsContent>
          </div>
          <VerificationSourceEditor
            text={text}
            target={target}
            onSave={checksDirty ? undefined : onSaveText}
            onRecheck={onRecheck}
            onDirtyChange={setSourceDirty}
          />
        </div>
      </Tabs>
    </aside>
  );
}
