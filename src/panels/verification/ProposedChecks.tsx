import { Badge } from '@prompt-studio/ui/badge';
import { Button } from '@prompt-studio/ui/button';
import { Textarea } from '@prompt-studio/ui/textarea';
import { useState } from 'react';
import type { CheckProposal } from '../../verification/check-proposals';
import { RULE_NAMES, ruleDescription } from './verification-editing';

/**
 * Checks an agent proposed for one profile. They are not saved: the person accepts one (as proposed, or after
 * editing it) or rejects it. Accepting saves it with the other check definitions.
 */
export function ProposedChecks({
  proposals,
  disabled,
  onAccept,
  onEditRule,
  onReject,
}: {
  proposals: readonly CheckProposal[];
  disabled: boolean;
  /** For a criterion, `statement` is the (possibly edited) text in the card. */
  onAccept: (proposal: CheckProposal, statement?: string) => void;
  onEditRule: (proposal: CheckProposal) => void;
  onReject: (proposal: CheckProposal) => void;
}) {
  if (proposals.length === 0) return null;
  return (
    <section aria-label="Proposed checks" className="space-y-3 rounded-md border border-dashed border-primary/60 p-3">
      <div>
        <h4 className="text-sm font-semibold">Proposed by your agent · not saved</h4>
        <p className="mt-1 text-xs text-muted-foreground">
          Accept a proposal to save it with these checks, edit it first, or reject it.
        </p>
      </div>
      <ul className="space-y-3">
        {proposals.map((proposal) => (
          <ProposedCheck
            key={proposal.id}
            proposal={proposal}
            disabled={disabled}
            onAccept={onAccept}
            onEditRule={onEditRule}
            onReject={onReject}
          />
        ))}
      </ul>
    </section>
  );
}

function ProposedCheck({
  proposal,
  disabled,
  onAccept,
  onEditRule,
  onReject,
}: {
  proposal: CheckProposal;
  disabled: boolean;
  onAccept: (proposal: CheckProposal, statement?: string) => void;
  onEditRule: (proposal: CheckProposal) => void;
  onReject: (proposal: CheckProposal) => void;
}) {
  const [statement, setStatement] = useState(proposal.kind === 'criterion' ? proposal.criterion.statement : '');
  const name = proposal.kind === 'rule' ? RULE_NAMES[proposal.rule.kind] : 'AI review criterion';
  return (
    <li aria-label={`Proposed check: ${name}`} className="min-w-0 space-y-2 border-b border-border pb-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-medium">{name}</p>
        <Badge variant="outline">Proposed</Badge>
      </div>
      {proposal.kind === 'rule' ? (
        <>
          <p className="break-words text-sm text-muted-foreground">{ruleDescription(proposal.rule)}</p>
          <p className="text-xs text-muted-foreground">
            {proposal.rule.severity} · {proposal.rule.enforcement}
          </p>
        </>
      ) : (
        <label className="block text-sm">
          Proposed AI criterion
          <Textarea
            aria-label="Proposed AI criterion"
            className="mt-1 min-h-20 text-sm"
            value={statement}
            disabled={disabled}
            onChange={(event) => setStatement(event.target.value)}
          />
        </label>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={disabled || (proposal.kind === 'criterion' && !statement.trim())}
          onClick={() => onAccept(proposal, proposal.kind === 'criterion' ? statement : undefined)}
        >
          Accept proposal
        </Button>
        {proposal.kind === 'rule' && (
          <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => onEditRule(proposal)}>
            Edit proposal
          </Button>
        )}
        <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => onReject(proposal)}>
          Reject proposal
        </Button>
      </div>
    </li>
  );
}
