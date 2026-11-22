/**
 * PolicyDecision — typed record of a single pipeline policy invocation.
 *
 * One typed shape, one storage collection, one event. Every silent
 * decision the `@prompt-studio/pipeline` package encodes (signal score gate,
 * draft eligibility, stage transition, insight selection, framework
 * choice, learning gate, watchlist due-check, tier promotion, etc.)
 * becomes inspectable, reproducible, and testable by recording one of
 * these at the call site.
 *
 * Designed for both end-user transparency ("Why did this happen?") and
 * developer debugging (replay an exact invocation with stored input).
 *
 * See ADR-079 for the full design.
 */

/**
 * Stable identifier for each wrapped policy.
 *
 * Adding a new entry here is a compile-time gate — every PolicyId must
 * also have a `POLICY_REGISTRY` entry below, so UI components can render
 * a human label and outcome hints without freeform strings.
 */
export type PolicyId =
  | 'signal-score-gate'
  | 'company-duplicate-gate'
  | 'can-receive-draft'
  | 'is-terminal-status'
  | 'stage-transition'
  | 'stage-confidence-gate'
  | 'unsubscribing-veto'
  | 'insight-select'
  | 'email-framework-select'
  | 'learning-threshold-gate'
  | 'watchlist-due-check'
  | 'tier-promotion'
  | 'tier-demotion'
  | 'unsubscribed-promotion-veto'
  | 'agent-profile-resolved'
  | 'reply-channel-classified'
  | 'conversation-reopen'
  | 'autopilot-mode'
  | 'learning-record-gate'
  | 'learning-rate-gate';

export type PolicyOutcome = 'allow' | 'block' | 'select' | 'transition' | 'no-op';

export type PolicyEntityKind = 'lead' | 'signal' | 'message' | 'account' | 'company' | 'workspace' | 'learning';

export interface PolicyEntityRef {
  kind: PolicyEntityKind;
  id: string;
}

export interface PolicyDecision {
  id: string;
  policy: PolicyId;
  outcome: PolicyOutcome;
  input: Record<string, unknown>;
  output: unknown;
  reasoning: string;
  entityRef: PolicyEntityRef;
  traceId?: string;
  policyVersion: string;
  workspaceId: string;
  timestamp: string;
  durationMs: number;
}

export interface PolicyRegistryEntry {
  id: PolicyId;
  label: string;
  description: string;
  outcomes: PolicyOutcome[];
}

/**
 * Human-readable metadata for every wrapped policy. Drives the UI
 * affordances ("Why?" popover label, decisions timeline grouping,
 * dev drawer filter chips).
 */
export const POLICY_REGISTRY: Record<PolicyId, PolicyRegistryEntry> = {
  'signal-score-gate': {
    id: 'signal-score-gate',
    label: 'Signal score gate',
    description: 'Drops signals whose score is below the workspace threshold.',
    outcomes: ['allow', 'block'],
  },
  'company-duplicate-gate': {
    id: 'company-duplicate-gate',
    label: 'Company duplicate gate',
    description:
      'Blocks creating a new company record when an existing record likely IS the same company (same registrable domain under another TLD, same normalized name, or a vanity-domain cross-match). The agent must attach to the canonical record or explicitly confirm a distinct company (ADR-143).',
    outcomes: ['allow', 'block'],
  },
  'can-receive-draft': {
    id: 'can-receive-draft',
    label: 'Draft eligibility',
    description:
      'Blocks new outreach drafts when the lead is in a terminal status (unsubscribed, closed_won/lost, escalated).',
    outcomes: ['allow', 'block'],
  },
  'is-terminal-status': {
    id: 'is-terminal-status',
    label: 'Terminal status check',
    description: 'Marks leads/conversations whose status precludes further automated action.',
    outcomes: ['allow', 'block'],
  },
  'stage-transition': {
    id: 'stage-transition',
    label: 'Stage transition',
    description: 'Conversation stage advanced from one value to another (manual or auto-critic driven).',
    outcomes: ['transition', 'no-op'],
  },
  'stage-confidence-gate': {
    id: 'stage-confidence-gate',
    label: 'Stage confidence gate',
    description: 'Inbound reply must clear the workspace confidence threshold before the lead advances to a new stage.',
    outcomes: ['allow', 'block'],
  },
  'unsubscribing-veto': {
    id: 'unsubscribing-veto',
    label: 'Unsubscribe veto',
    description: 'An UNSUBSCRIBING intent vetoes any stage advance regardless of confidence.',
    outcomes: ['allow', 'block'],
  },
  'insight-select': {
    id: 'insight-select',
    label: 'Insight selected',
    description: 'Closer picked one insight for the draft based on stage, role, and industry match.',
    outcomes: ['select', 'no-op'],
  },
  'email-framework-select': {
    id: 'email-framework-select',
    label: 'Email framework',
    description:
      'Signal type drove the choice of cold-email framework (Signal-Reference, Pain-Agitate-Solve, Proof-First).',
    outcomes: ['select'],
  },
  'learning-threshold-gate': {
    id: 'learning-threshold-gate',
    label: 'Learning section gate',
    description: 'Learning prompt section suppressed because there are too few labelled outcomes.',
    outcomes: ['allow', 'block'],
  },
  'watchlist-due-check': {
    id: 'watchlist-due-check',
    label: 'Watchlist due check',
    description: 'Decides whether a watchlist entry is due for re-scan based on its cadence (7 day / 30 day).',
    outcomes: ['allow', 'no-op'],
  },
  'tier-promotion': {
    id: 'tier-promotion',
    label: 'Tier promotion',
    description: 'Account upgraded a tier (Tier-3 → Tier-2, Tier-2 → Tier-1) based on engagement and avg-signal score.',
    outcomes: ['transition', 'no-op'],
  },
  'tier-demotion': {
    id: 'tier-demotion',
    label: 'Tier demotion',
    description: 'Account downgraded a tier (Tier-1 → Tier-2) after 90 days without engagement.',
    outcomes: ['transition', 'no-op'],
  },
  'unsubscribed-promotion-veto': {
    id: 'unsubscribed-promotion-veto',
    label: 'Unsubscribed veto',
    description: 'Tier promotion blocked because every lead on the account has unsubscribed.',
    outcomes: ['block'],
  },
  'agent-profile-resolved': {
    id: 'agent-profile-resolved',
    label: 'Agent profile resolved',
    description:
      'Agent runtime picked the configured profile (iteration cap, token budget, tool allowlist) for the run.',
    outcomes: ['select'],
  },
  'reply-channel-classified': {
    id: 'reply-channel-classified',
    label: 'Reply classified',
    description: 'Inbound email classified as a reply, bounce, or auto-reply (RFC 3464 / RFC 3834 heuristics).',
    outcomes: ['select'],
  },
  'conversation-reopen': {
    id: 'conversation-reopen',
    label: 'Conversation reopen',
    description:
      'Operator override moving a lead out of a terminal stage (Closed Lost/Won, Escalation) back to an active stage. Suppression is re-checked and unsubscribed contacts are never reopenable (ADR-090 §C).',
    outcomes: ['transition'],
  },
  'autopilot-mode': {
    id: 'autopilot-mode',
    label: 'Autopilot mode',
    description:
      "Operator changed a lead's Plane C execution mode (arm / disarm / re-arm), engaging or disengaging bounded autopilot (PRD-029 / ADR-090 §B).",
    outcomes: ['transition', 'no-op'],
  },
  'learning-record-gate': {
    id: 'learning-record-gate',
    label: 'Learning record gate',
    description:
      'Decides whether a Scout run may store a proposed Learning: the input must validate, the run must be under its per-run cap, and the statement must be neither a duplicate in scope nor recently retired (ADR-281).',
    outcomes: ['allow', 'block'],
  },
  'learning-rate-gate': {
    id: 'learning-rate-gate',
    label: 'Learning rate gate',
    description:
      'Only a Learning injected into this run or returned by recall_learnings in it may be rated, so a run cannot move the rating of a Learning it never saw (ADR-281).',
    outcomes: ['allow', 'block'],
  },
};

export const POLICY_DECISIONS_COLLECTION = 'policy_decisions';

export const POLICY_VERSION_DEFAULT = 'v1';

export const POLICY_DECISIONS_DEFAULT_RETENTION_DAYS = 30;
