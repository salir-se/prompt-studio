import { Button } from '@prompt-studio/ui/button';
import { cn } from '@prompt-studio/ui/utils';

export type VerificationCheckStatus = 'not-checked' | 'current' | 'stale';
export interface SectionVerificationCoverage {
  readonly sectionId: string;
  readonly automatic: { readonly basic: number; readonly custom: number; readonly status: VerificationCheckStatus };
  readonly ai: { readonly generated: number; readonly custom: number; readonly status: VerificationCheckStatus };
}
export type OpenSectionVerification = (sectionId: string, tab: 'checks' | 'ai') => void;
const STATUS = { 'not-checked': 'Not checked', current: 'Current', stale: 'Stale' } as const;

/** Configuration counts never imply that checks passed or AI review ran. */
export function VerificationCoverage({
  title,
  coverage,
  onOpen,
  compact = false,
}: {
  title: string;
  coverage: SectionVerificationCoverage;
  onOpen?: OpenSectionVerification;
  compact?: boolean;
}) {
  const entries = [
    {
      tab: 'checks' as const,
      label: 'Auto',
      count: coverage.automatic.basic + coverage.automatic.custom,
      detail: `${coverage.automatic.basic} basic · ${coverage.automatic.custom} custom`,
      name: `Automatic checks for ${title}: ${coverage.automatic.basic} basic, ${coverage.automatic.custom} custom`,
      status: coverage.automatic.status,
      help: 'Basic checks validate non-empty content, known variables and cache placement. Custom checks express configured requirements.',
    },
    {
      tab: 'ai' as const,
      label: 'AI',
      count: coverage.ai.generated + coverage.ai.custom,
      detail: `${coverage.ai.generated} Design · ${coverage.ai.custom} custom`,
      name: `AI criteria for ${title}: ${coverage.ai.generated} derived from Design, ${coverage.ai.custom} custom`,
      status: coverage.ai.status,
      help: 'Design criteria are derived from input, workflow and output contracts. AI review is optional and runs separately.',
    },
  ];
  return (
    <fieldset
      className={cn(
        'nodrag nopan nokey m-0 grid min-w-0 shrink-0 grid-cols-2 border-0 p-0',
        compact ? 'gap-1' : 'gap-2',
      )}
      aria-label={`Verification coverage for ${title}`}
    >
      {entries.map((entry) => {
        const content = (
          <>
            <span className="text-[11px] font-medium">
              <span>
                {entry.label} {entry.count}
              </span>{' '}
              {!compact && <>· {STATUS[entry.status]}</>}
            </span>
            {!compact && <span className="text-[10px] text-muted-foreground">{entry.detail}</span>}
          </>
        );
        const name = `${entry.name}, ${STATUS[entry.status].toLowerCase()}`;
        return onOpen ? (
          <Button
            key={entry.tab}
            type="button"
            variant="outline"
            aria-label={name}
            title={`${name}. ${entry.help}`}
            className={cn('h-auto min-w-0 flex-col gap-0 rounded-md px-1 py-1.5', compact ? 'min-h-8' : 'min-h-11')}
            onKeyDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation();
              onOpen(coverage.sectionId, entry.tab);
            }}
          >
            {content}
          </Button>
        ) : (
          <section
            key={entry.tab}
            aria-label={name}
            title={`${name}. ${entry.help}`}
            className={cn(
              'flex min-w-0 flex-col items-center justify-center rounded-md border px-1 py-1.5',
              compact ? 'min-h-8' : 'min-h-11',
            )}
          >
            {content}
          </section>
        );
      })}
    </fieldset>
  );
}
