import type { PromptVerificationFinding } from '@prompt-studio/prompts';
import { Badge } from '@prompt-studio/ui/badge';
import { Button } from '@prompt-studio/ui/button';

export function VerificationFindings({
  findings,
  label = 'Findings',
  scopeName,
  onOpen,
}: {
  findings: readonly PromptVerificationFinding[];
  label?: string;
  scopeName: (id?: string) => string;
  onOpen?: (finding: PromptVerificationFinding) => void;
}) {
  return (
    <ul aria-label={label} className="space-y-3">
      {findings.map((finding) => (
        <li
          key={JSON.stringify(finding)}
          data-testid={finding.source === 'semantic' ? 'semantic-finding' : 'automatic-finding'}
          className="min-w-0 space-y-3 rounded-lg border border-border p-4"
        >
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge
              variant={finding.severity === 'error' ? 'destructive' : 'outline'}
              className={finding.severity === 'error' ? 'text-red-700 dark:text-red-300' : undefined}
            >
              {finding.source === 'semantic' ? 'AI · ' : ''}
              {finding.severity}
            </Badge>
            <span className="text-muted-foreground">
              {scopeName(finding.scope === 'section' ? finding.sectionId : undefined)}
            </span>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm">{finding.message}</p>
          {finding.source === 'semantic' && (
            <>
              <blockquote className="whitespace-pre-wrap break-words border-l-2 pl-3 text-sm">
                <span className="font-medium">Evidence:</span> “{finding.evidenceQuote}”
              </blockquote>
              <p className="whitespace-pre-wrap break-words text-sm">
                <span className="font-medium">Correction:</span> {finding.proposedCorrection}
              </p>
            </>
          )}
          {onOpen && (
            <Button type="button" size="sm" variant="outline" onClick={() => onOpen(finding)}>
              View source
            </Button>
          )}
          <details className="text-xs text-muted-foreground">
            <summary className="cursor-pointer">Technical details</summary>
            <p className="mt-2 break-all">
              Profile: {finding.profile.id} · version {finding.profile.version}
            </p>
            <p className="break-all">
              {finding.source === 'semantic'
                ? `Criterion: ${finding.principleId}`
                : `Rule: ${finding.ruleId} · ${finding.enforcement}`}
            </p>
          </details>
        </li>
      ))}
    </ul>
  );
}
