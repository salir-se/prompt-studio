/**
 * Check proposals (roadmap #8): an agent may PROPOSE an automatic check or an AI review criterion; only the person
 * can save it. A proposal lives in the editor tab (not in the design) until the person accepts it in
 * Verify → Checks & criteria — as proposed, or after editing it — or rejects it. Proposals are kept for the tab's
 * lifetime; a reload drops pending ones.
 */

import type { PromptVerificationPrinciple, PromptVerificationRule } from '@prompt-studio/prompts';
import { useCallback, useState } from 'react';

export type ProposalStatus = 'pending' | 'accepted' | 'edited' | 'rejected';

interface ProposalBase {
  readonly id: string;
  readonly rootId: string;
  /** `WHOLE_PROMPT` or a design section id (the Verify panel's scope). */
  readonly scope: string;
  /** The design verification profile the check would join. */
  readonly profileId: string;
  readonly status: ProposalStatus;
}

export type CheckProposal = ProposalBase &
  (
    | { readonly kind: 'rule'; readonly rule: PromptVerificationRule; readonly saved?: PromptVerificationRule }
    | {
        readonly kind: 'criterion';
        readonly criterion: PromptVerificationPrinciple;
        readonly saved?: PromptVerificationPrinciple;
      }
  );

/** What the person saved, compared with what was proposed. */
export function acceptedStatus(proposal: CheckProposal, saved: unknown): 'accepted' | 'edited' {
  const proposed = proposal.kind === 'rule' ? proposal.rule : proposal.criterion;
  return JSON.stringify(proposed) === JSON.stringify(saved) ? 'accepted' : 'edited';
}

/** Applies the person's decision. A decided proposal keeps its first decision. */
export function resolveProposal(
  proposals: readonly CheckProposal[],
  id: string,
  status: Exclude<ProposalStatus, 'pending'>,
  saved?: PromptVerificationRule | PromptVerificationPrinciple,
): CheckProposal[] {
  return proposals.map((proposal) =>
    proposal.id !== id || proposal.status !== 'pending'
      ? proposal
      : ({ ...proposal, status, ...(saved === undefined ? {} : { saved }) } as CheckProposal),
  );
}

export function useCheckProposals() {
  const [proposals, setProposals] = useState<readonly CheckProposal[]>([]);
  const add = useCallback((proposal: CheckProposal) => setProposals((current) => [...current, proposal]), []);
  const resolve = useCallback(
    (
      id: string,
      status: Exclude<ProposalStatus, 'pending'>,
      saved?: PromptVerificationRule | PromptVerificationPrinciple,
    ) => setProposals((current) => resolveProposal(current, id, status, saved)),
    [],
  );
  return { proposals, add, resolve };
}

export type CheckProposals = ReturnType<typeof useCheckProposals>;
