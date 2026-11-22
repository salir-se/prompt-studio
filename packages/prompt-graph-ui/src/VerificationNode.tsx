/**
 * VerificationNode — a presentational, read-only card rendering one
 * verification-principles projection (state + principles + findings) for
 * the prompt graph studio, consuming the REAL contracts merged into
 * `@prompt-studio/prompts` (ADR-200 §9 / ADR-202 §8): `PromptVerificationPrinciple`,
 * `PromptVerificationFinding`, and the five-state `PromptVerificationState`
 * union. It does not invent a parallel shape — every field this component
 * reads is one already produced by `runPromptVerificationProfile` /
 * `derivePromptVerificationState`.
 *
 * Pure by design, matching `FragmentNode`/`LabelChip`/`ToolDefinitionNode`/
 * `SkillMountNode`: no data fetching, no `useEffect`, no graph-rendering
 * library import, no semantic-review call of its own — the studio's bridge
 * process (ADR-202 §8) is what produces a `PromptVerificationReport`; this
 * component only renders whatever slice of it (`state`/`principles`/
 * `findings`) its caller hands it as props.
 *
 * State colours: `valid` = muted (nothing to report yet), `verified` =
 * emerald (semantic review passed), `warning` = amber (needs
 * acknowledgement), `invalid` = destructive/red (a hard deterministic
 * finding), `degraded` = slate (semantic review unavailable — ADR-151's
 * "absence degrades, never blocks" posture). Finding rows reuse the same
 * `info`/`warning`/`error` severity vocabulary as `PromptVerificationSeverity`.
 * Principle rows tint their owner chip violet for `platform` (protected,
 * read-only blueprint data per ADR-202 §8) and neutral for `configuration`.
 */

import type {
  PromptVerificationFinding,
  PromptVerificationPrinciple,
  PromptVerificationState,
} from '@prompt-studio/prompts';
import { cn } from '@prompt-studio/ui/utils';

export interface VerificationNodeProps {
  /** The card's heading — typically the verified section/blueprint's own title. */
  title: string;
  /** The report's overall verification state — see `derivePromptVerificationState`. */
  state: PromptVerificationState;
  /** The semantic principles in scope for this verification (platform- or configuration-owned). */
  principles: readonly PromptVerificationPrinciple[];
  /** Deterministic + semantic findings, when the report has any. Omitted/empty renders no findings section. */
  findings?: readonly PromptVerificationFinding[];
  /** Whether this node is the current selection in a containing graph/list view. */
  selected?: boolean;
}

const STATE_BADGE_CLASSES: Record<PromptVerificationState, string> = {
  valid: 'bg-muted text-muted-foreground',
  verified: 'bg-emerald-100/70 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-300',
  warning: 'bg-amber-100/80 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200',
  invalid: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
  degraded: 'bg-slate-100/80 text-slate-700 dark:bg-slate-800/60 dark:text-slate-300',
};

const OWNER_CHIP_CLASSES: Record<PromptVerificationPrinciple['owner'], string> = {
  platform: 'bg-violet-100/70 text-violet-800 dark:bg-violet-900/50 dark:text-violet-300',
  configuration: 'bg-muted text-muted-foreground',
};

const FINDING_SEVERITY_CLASSES: Record<PromptVerificationFinding['severity'], string> = {
  info: 'bg-sky-100/70 text-sky-800 dark:bg-sky-900/50 dark:text-sky-300',
  warning: 'bg-amber-100/80 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200',
  error: 'bg-destructive/10 text-destructive dark:bg-destructive/20',
};

const CHIP_BASE_CLASSES = 'inline-flex shrink-0 items-center rounded-sm px-1.5 py-0.5 font-mono text-[10px]';

function findingKey(finding: PromptVerificationFinding, index: number): string {
  return `${finding.profile.id}@${finding.profile.version}-${index}`;
}

export function VerificationNode({
  title,
  state,
  principles,
  findings = [],
  selected = false,
}: VerificationNodeProps): React.JSX.Element {
  return (
    <article
      aria-label={title}
      aria-current={selected ? 'true' : undefined}
      data-selected={selected}
      data-state={state}
      data-testid="verification-node"
      className={cn(
        'flex w-[360px] flex-col gap-2 rounded-lg border border-border bg-card p-3 text-card-foreground',
        selected && 'ring-2 ring-ring',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold">{title}</h3>
        <span
          data-testid="verification-node-state"
          className={cn(CHIP_BASE_CLASSES, STATE_BADGE_CLASSES[state], 'text-xs')}
        >
          {state}
        </span>
      </div>
      {principles.length > 0 && (
        <div className="flex min-h-0 flex-col gap-1">
          <span className="text-xs text-muted-foreground">Principles</span>
          <ul className="flex max-h-40 flex-col gap-1 overflow-y-auto" aria-label="Principles">
            {principles.map((principle) => (
              <li
                key={principle.id}
                className="flex items-start justify-between gap-2 rounded-sm bg-muted px-2 py-1 text-xs"
              >
                <div className="min-w-0">
                  <span className="mr-1 font-mono text-muted-foreground">{principle.id}</span>
                  <span className="text-foreground">{principle.statement}</span>
                </div>
                <span className={cn(CHIP_BASE_CLASSES, OWNER_CHIP_CLASSES[principle.owner])}>{principle.owner}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      {findings.length > 0 && (
        <div className="flex min-h-0 flex-col gap-1">
          <span className="text-xs text-muted-foreground">Findings</span>
          <ul className="flex max-h-24 flex-col gap-1 overflow-y-auto" aria-label="Findings">
            {findings.map((finding, index) => (
              <li key={findingKey(finding, index)} className="flex items-start gap-2 rounded-sm px-2 py-1 text-xs">
                <span className={cn(CHIP_BASE_CLASSES, FINDING_SEVERITY_CLASSES[finding.severity])}>
                  {finding.severity}
                </span>
                <span className="min-w-0 truncate text-muted-foreground">{finding.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}
