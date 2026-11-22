// @vitest-environment node
// @module-tag pure
import { describe, expect, it } from 'vitest';
import { acceptedStatus, type CheckProposal, resolveProposal } from './check-proposals';

const rule = {
  id: 'agent-1',
  kind: 'required-tool',
  name: 'lookup_order',
  severity: 'error',
  enforcement: 'edit',
} as const;
const proposal: CheckProposal = {
  id: 'p1',
  rootId: 'order-status',
  scope: '__whole_prompt__',
  profileId: 'profile',
  status: 'pending',
  kind: 'rule',
  rule,
};

describe('check proposals', () => {
  it('reads accepted when the saved check equals the proposal, edited otherwise', () => {
    // Given / When / Then: an identical saved rule is accepted; a changed severity is edited
    expect(acceptedStatus(proposal, rule)).toBe('accepted');
    expect(acceptedStatus(proposal, { ...rule, severity: 'warning' })).toBe('edited');
  });

  it('keeps the first decision of a proposal', () => {
    // Given: a proposal the person accepted
    const accepted = resolveProposal([proposal], 'p1', 'accepted', rule);
    // When: a second decision arrives for it
    const again = resolveProposal(accepted, 'p1', 'rejected');
    // Then: it stays accepted with the saved check
    expect(again[0]).toMatchObject({ status: 'accepted', saved: rule });
  });
});
