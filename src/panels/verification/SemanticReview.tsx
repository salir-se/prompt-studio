import { Button } from '@prompt-studio/ui/button';
import type { VerificationSectionResult } from '../root-verification';
import { VerificationFindings } from './VerificationFindings';
import type { SemanticReviewState } from './use-semantic-review';

export function SemanticReview({
  review,
  section,
  busy,
  disabled,
  onRun,
  onOpen,
  scopeName,
  onSettings,
  pending,
}: {
  review: SemanticReviewState;
  section?: VerificationSectionResult;
  busy: boolean;
  disabled: boolean;
  onRun: () => void;
  onOpen: React.ComponentProps<typeof VerificationFindings>['onOpen'];
  scopeName: (id?: string) => string;
  onSettings?: () => void;
  pending?: boolean;
}) {
  return (
    <section aria-label="Semantic review" data-testid="semantic-review" className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3 rounded-lg border bg-muted/20 p-4">
        <div>
          <h3 className="text-sm font-semibold">AI review</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            {section?.profile.principles.length ?? 0} saved criteria · uses your configured provider and consumes
            tokens.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {onSettings && (
            <Button type="button" size="sm" variant="outline" onClick={onSettings}>
              Connection settings
            </Button>
          )}
          <Button
            type="button"
            size="sm"
            data-testid="semantic-review-run"
            onClick={onRun}
            disabled={disabled || busy || !section?.profile.principles.length}
          >
            {review.status === 'loading' ? 'Reviewing…' : review.status === 'idle' ? 'Run AI review' : 'Run again'}
          </Button>
        </div>
      </div>
      {pending && (
        <p role="status" className="text-sm">
          Wait for project saving to finish before reviewing the saved instructions.
        </p>
      )}
      <p className="text-sm">
        {section
          ? `Scope: ${section.heading}. Includes ${section.dependencies.length} declared context section${section.dependencies.length === 1 ? '' : 's'}.`
          : 'Choose a section with AI criteria. Whole-prompt AI review is not configured for this prompt.'}
      </p>
      {review.status === 'idle' && (
        <p data-testid="semantic-review-idle" className="text-sm text-muted-foreground">
          AI review has not run for this scope. Automatic checks remain separate.
        </p>
      )}
      {review.status === 'loading' && (
        <p role="status" data-testid="semantic-review-loading">
          Reviewing the selected scope… You can inspect other scopes while this completes.
        </p>
      )}
      {review.status === 'unavailable' && (
        <p role="note" data-testid="semantic-review-unavailable" className="text-sm">
          No AI provider key is configured for this session. Configure the AI provider for this Studio session, then
          retry. Automatic checks still apply.
        </p>
      )}
      {review.status === 'stale' && (
        <p role="alert" className="text-sm">
          The saved prompt or criteria changed. Recheck the prompt, then run a fresh AI review.
        </p>
      )}
      {review.status === 'busy' && (
        <p role="status" className="text-sm">
          Two reviews are already running. Wait for one to finish, then try again.
        </p>
      )}
      {review.status === 'budget-exhausted' && (
        <p role="status" data-testid="semantic-review-budget-exhausted" className="text-sm">
          This session has used its semantic-review budget for now. Automatic checks still apply; retry when the budget
          is available.
        </p>
      )}
      {review.status === 'failed' && (
        <p role="alert" data-testid="semantic-review-failed" className="text-sm text-destructive">
          AI review couldn't complete. Your source and automatic results are retained. Try again.
        </p>
      )}
      {review.status === 'results' && (
        <div data-testid="semantic-review-results" className="space-y-3">
          {review.model && <p className="text-xs text-muted-foreground">Reviewed by {review.model}</p>}
          {!review.findings.length ? (
            <p data-testid="semantic-review-no-findings" className="text-sm">
              No AI issues found in {section?.heading}. This is an AI assessment of the reviewed scope.
            </p>
          ) : (
            <VerificationFindings
              label="Semantic findings"
              findings={review.findings}
              scopeName={scopeName}
              onOpen={onOpen}
            />
          )}
        </div>
      )}
      <details className="text-sm">
        <summary className="cursor-pointer">Review criteria and context</summary>
        <ul className="mt-3 space-y-3">
          {section?.profile.principles.map((criterion) => (
            <li key={criterion.id} className="space-y-1">
              <p>{criterion.statement}</p>
              <p className="text-xs text-muted-foreground">
                {criterion.owner === 'platform' ? 'Protected criterion · platform · read-only' : 'Authored criterion'} ·{' '}
                {criterion.allowedCustomization}
              </p>
            </li>
          ))}
        </ul>
        {!!section?.dependencies.length && (
          <p className="mt-3 text-xs text-muted-foreground">
            Included context: {section.dependencies.map((dependency) => scopeName(dependency.sectionId)).join(', ')}.
          </p>
        )}
      </details>
    </section>
  );
}
