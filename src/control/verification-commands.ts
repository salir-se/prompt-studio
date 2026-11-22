/**
 * Verification commands for remote control (roadmap #8; docs/remote-control.md): list the automatic checks and
 * AI review criteria per scope, run the automatic checks, read the latest automatic and AI-review findings with
 * their freshness, and PROPOSE a check.
 *
 * Human in the loop: `proposeCheck` never saves. The proposal appears in Verify → Checks & criteria marked
 * "Proposed", and only the person can accept it (as proposed or edited) or reject it; `getProposalStatus` reports
 * the decision. AI review is a paid model call, so it stays a person's action: these commands only read its results.
 */

import { ControlCommandError } from '@prompt-studio/control-protocol';
import {
  type PromptTree,
  type PromptVerificationFinding,
  type PromptVerificationPrinciple,
  type PromptVerificationProfile,
  type PromptVerificationRule,
  PromptVerificationRuleSchema,
} from '@prompt-studio/prompts';
import { type } from 'arktype';
import type { CatalogRoot } from '../catalog/root-catalog';
import type { VerificationRunResult } from '../panels/root-verification';
import type { SemanticReviewState } from '../panels/verification/use-semantic-review';
import {
  profilesForScope,
  RULE_NAMES,
  ruleDescription,
  WHOLE_PROMPT,
} from '../panels/verification/verification-editing';
import type { CheckProposal } from '../verification/check-proposals';
import type { ControlHandler } from './control-channel';
import { resolveDesignSectionId } from './design-commands';

export interface VerificationCommandSurface {
  readonly loadedDocument: { readonly rootId: string; readonly variantSymbol?: string; readonly text: string } | null;
  readonly tree: PromptTree | null;
  /** The open prompt's catalog root, with its verification profiles and design. */
  readonly root: CatalogRoot | undefined;
  /** The latest automatic-check run shown in Verify, and whether it matches the current text and checks. */
  readonly latest: { readonly result: VerificationRunResult; readonly freshness: 'current' | 'stale' } | null;
  /** Opens Verify → Findings and runs the automatic checks (the Verify button); null when Verify did not open. */
  runChecks(): VerificationRunResult | null;
  /** The AI review session: one review per scope, and whether each is current or stale. */
  readonly semantic: {
    forSection(section: VerificationRunResult['sections'][number]): SemanticReviewState;
    readonly statusBySectionId: Readonly<Record<string, string>>;
  };
  readonly proposals: readonly CheckProposal[];
  addProposal(proposal: CheckProposal): void;
  /** Opens Verify → Checks & criteria on a scope; false when the person kept unsaved panel changes. */
  showChecks(scope: string): boolean;
  /** Fresh ids for proposals; injectable for tests. */
  newId?: () => string;
}

type Args = Record<string, unknown>;

function record(args: unknown): Args {
  return typeof args === 'object' && args !== null ? (args as Args) : {};
}

function optionalText(args: Args, key: string): string | undefined {
  const value = args[key];
  if (value === undefined) return undefined;
  if (typeof value !== 'string') throw new ControlCommandError('invalid_input', `${key} must be a string.`);
  return value;
}

const SEVERITY = type("'info' | 'warning' | 'error'");

/** The API name of a Verify scope: null for the whole prompt, else the design section id. */
function scopeName(scope: string): string | null {
  return scope === WHOLE_PROMPT ? null : scope;
}

function describeFinding(finding: PromptVerificationFinding) {
  return {
    source: finding.source,
    severity: finding.severity,
    message: finding.message,
    sectionId: finding.scope === 'section' ? finding.sectionId : null,
    ...(finding.source === 'deterministic'
      ? { ruleId: finding.ruleId, enforcement: finding.enforcement }
      : {
          principleId: finding.principleId,
          evidenceQuote: finding.evidenceQuote,
          proposedCorrection: finding.proposedCorrection,
        }),
  };
}

function describeProposal(proposal: CheckProposal) {
  return {
    proposalId: proposal.id,
    kind: proposal.kind,
    sectionId: scopeName(proposal.scope),
    profileId: proposal.profileId,
    status: proposal.status,
    ...(proposal.kind === 'rule'
      ? { check: proposal.rule, description: ruleDescription(proposal.rule) }
      : { check: proposal.criterion, description: proposal.criterion.statement }),
    ...(proposal.saved === undefined ? {} : { saved: proposal.saved }),
  };
}

export function buildVerificationCommands(surface: VerificationCommandSurface): Record<string, ControlHandler> {
  const newId = surface.newId ?? (() => crypto.randomUUID());

  function openRoot(args: Args): { rootId: string; root: CatalogRoot } {
    const rootId = optionalText(args, 'rootId');
    if (!rootId) throw new ControlCommandError('invalid_input', 'rootId is required.');
    const loaded = surface.loadedDocument;
    if (loaded === null) throw new ControlCommandError('command_failed', 'Open a document first (openDocument).');
    if (loaded.rootId !== rootId || loaded.variantSymbol !== optionalText(args, 'variantSymbol')) {
      throw new ControlCommandError(
        'command_failed',
        `Open "${rootId}" first (openDocument) — verification commands apply to the open document, now "${loaded.rootId}".`,
      );
    }
    if (surface.root === undefined || surface.root.verification === undefined) {
      throw new ControlCommandError('command_failed', `"${rootId}" has no verification checks.`);
    }
    return { rootId, root: surface.root };
  }

  /** The Verify scope for `sectionId` (WHOLE_PROMPT when it is left out). */
  function scopeOf(args: Args, rootId: string, root: CatalogRoot): string {
    const requested = optionalText(args, 'sectionId');
    if (requested === undefined || requested === '') return WHOLE_PROMPT;
    if (root.design) return resolveDesignSectionId(requested, rootId, root.design, surface.tree) ?? WHOLE_PROMPT;
    const known = (root.verification?.profiles ?? []).some(
      (profile) => profile.scope === 'section' && profile.sectionId === requested,
    );
    if (!known) throw new ControlCommandError('missing_target', `No section "${requested}" with checks.`);
    return requested;
  }

  function describeProfile(profile: PromptVerificationProfile, root: CatalogRoot) {
    const authored = root.design?.verificationProfiles.find((item) => item.id === profile.id);
    return {
      profileId: profile.id,
      automatic: profile.deterministicRules.map((rule) => ({
        id: rule.id,
        kind: rule.kind,
        name: RULE_NAMES[rule.kind],
        description: ruleDescription(rule),
        severity: rule.severity,
        enforcement: rule.enforcement,
        state: 'saved' as const,
        origin: authored?.deterministicRules.some((item) => item.id === rule.id) ? 'authored' : 'studio',
      })),
      criteria: profile.principles.map((criterion) => ({
        id: criterion.id,
        statement: criterion.statement,
        severity: criterion.severity,
        state: 'saved' as const,
        origin:
          criterion.owner === 'platform'
            ? 'platform'
            : authored?.principles.some((item) => item.id === criterion.id)
              ? 'authored'
              : 'derived from design',
      })),
    };
  }

  function scopes(root: CatalogRoot): string[] {
    const sections = (root.verification?.profiles ?? []).flatMap((profile) =>
      profile.scope === 'section' ? [profile.sectionId] : [],
    );
    return [WHOLE_PROMPT, ...new Set(sections)];
  }

  return {
    listChecks: (raw) => {
      const args = record(raw);
      const { rootId, root } = openRoot(args);
      const requested = optionalText(args, 'sectionId');
      const selected = requested === undefined ? scopes(root) : [scopeOf(args, rootId, root)];
      return {
        rootId,
        scopes: selected.map((scope) => ({
          sectionId: scopeName(scope),
          profiles: profilesForScope(root.verification?.profiles ?? [], scope).map((profile) =>
            describeProfile(profile, root),
          ),
          proposed: surface.proposals
            .filter(
              (proposal) => proposal.rootId === rootId && proposal.scope === scope && proposal.status === 'pending',
            )
            .map((proposal) => ({ ...describeProposal(proposal), state: 'proposed' as const })),
        })),
      };
    },

    runChecks: (raw) => {
      const { rootId } = openRoot(record(raw));
      const result = surface.runChecks();
      if (result === null) {
        throw new ControlCommandError(
          'command_failed',
          'Verify did not open: the person kept unsaved changes in an open panel. Ask them to save or close it.',
        );
      }
      const count = (severity: string) => result.findings.filter((finding) => finding.severity === severity).length;
      return {
        rootId,
        state: result.state,
        counts: { error: count('error'), warning: count('warning'), info: count('info') },
        findings: result.findings.map(describeFinding),
      };
    },

    getFindings: (raw) => {
      const { rootId } = openRoot(record(raw));
      const latest = surface.latest;
      if (latest === null) {
        return { rootId, automatic: { freshness: 'none', findings: [] }, aiReview: [] };
      }
      const { result, freshness } = latest;
      return {
        rootId,
        automatic: { freshness, state: result.state, findings: result.findings.map(describeFinding) },
        aiReview: result.sections.map((section) => {
          const key = section.profile.scope === 'section' ? section.sectionId : WHOLE_PROMPT;
          const review = surface.semantic.forSection(section);
          return {
            sectionId: scopeName(key),
            status: review.status,
            freshness: surface.semantic.statusBySectionId[key] ?? 'not-checked',
            model: review.model,
            ...(review.reviewedAt === undefined ? {} : { reviewedAt: review.reviewedAt }),
            findings: review.findings.map(describeFinding),
          };
        }),
      };
    },

    proposeCheck: (raw) => {
      const args = record(raw);
      const { rootId, root } = openRoot(args);
      if (root.design === undefined) {
        throw new ControlCommandError(
          'command_failed',
          `"${rootId}" has registered, read-only checks. Proposals need a prompt created or adopted in Prompt Studio.`,
        );
      }
      const scope = scopeOf(args, rootId, root);
      const profile = profilesForScope(root.design.verificationProfiles, scope)[0];
      if (!profile) {
        throw new ControlCommandError(
          'missing_target',
          `No editable checks for ${scopeName(scope) ?? 'the whole prompt'}.`,
        );
      }
      const kind = optionalText(args, 'kind');
      const id = newId();
      let proposal: CheckProposal;
      if (kind === 'rule') {
        const input = args.rule;
        if (typeof input !== 'object' || input === null || Array.isArray(input)) {
          throw new ControlCommandError('invalid_input', 'rule is required for kind "rule": { kind, …fields }.');
        }
        const candidate = PromptVerificationRuleSchema({
          id: `agent-${id}`,
          severity: 'warning',
          enforcement: 'edit',
          ...(input as Record<string, unknown>),
        });
        if (candidate instanceof type.errors) throw new ControlCommandError('invalid_input', candidate.summary);
        proposal = {
          id: `proposal-${id}`,
          rootId,
          scope,
          profileId: profile.id,
          status: 'pending',
          kind: 'rule',
          rule: candidate as PromptVerificationRule,
        };
      } else if (kind === 'criterion') {
        const statement = optionalText(args, 'statement')?.trim();
        if (!statement) throw new ControlCommandError('invalid_input', 'statement is required for kind "criterion".');
        const severity = SEVERITY(args.severity ?? 'warning');
        if (severity instanceof type.errors)
          throw new ControlCommandError('invalid_input', `severity ${severity.summary}`);
        const criterion: PromptVerificationPrinciple = {
          id: `criterion-${id}`,
          version: 1,
          owner: 'configuration',
          statement,
          severity,
          allowedCustomization: 'The prompt author may revise this criterion.',
          sectionIds: profile.scope === 'section' ? [profile.sectionId] : [],
        };
        proposal = { id: `proposal-${id}`, rootId, scope, profileId: profile.id, status: 'pending', kind, criterion };
      } else {
        throw new ControlCommandError('invalid_input', 'kind must be "rule" or "criterion".');
      }
      if (!surface.showChecks(scope)) {
        throw new ControlCommandError(
          'command_failed',
          'Verify did not open: the person kept unsaved changes in an open panel. Nothing was proposed.',
        );
      }
      surface.addProposal(proposal);
      return { ...describeProposal(proposal), status: 'proposed' };
    },

    getProposalStatus: (raw) => {
      const proposalId = optionalText(record(raw), 'proposalId');
      const proposal = surface.proposals.find((candidate) => candidate.id === proposalId);
      if (!proposal) {
        throw new ControlCommandError(
          'missing_target',
          `No proposal "${proposalId}" in this tab. Proposals last until the tab reloads; propose it again.`,
        );
      }
      return describeProposal(proposal);
    },
  };
}
