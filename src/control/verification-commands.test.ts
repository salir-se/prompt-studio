// @vitest-environment node
// @module-tag pure
import { ControlCommandError } from '@prompt-studio/control-protocol';
import { parsePromptTree } from '@prompt-studio/prompts';
import { describe, expect, it, vi } from 'vitest';
import type { CatalogRoot } from '../catalog/root-catalog';
import {
  authoredPromptRootsFromHeads,
  promptDesignProviderKey,
  serializePromptDesign,
} from '../design/prompt-design-project';
import { runRootVerification } from '../panels/root-verification';
import { IDLE_REVIEW } from '../panels/verification/use-semantic-review';
import { WHOLE_PROMPT } from '../panels/verification/verification-editing';
import { createWorkspacePrompt } from '../prompt-repo/workspace-document';
import { type CheckProposal, resolveProposal } from '../verification/check-proposals';
import { buildVerificationCommands, type VerificationCommandSurface } from './verification-commands';

/**
 * The verification commands' contract (roadmap #8): checks are listed per scope with their state, automatic checks
 * run through Verify, findings carry their freshness, and a proposed check is only ever PROPOSED — it is stored for
 * the person to decide, never saved by the command.
 */

const TEXT = [
  '<role>\nYou are the order-status assistant.\n</role>',
  '<tools>\nCall lookup_order with the order id in {{customer_message}}.\n</tools>',
  '<output>\nReply with JSON.\n</output>\n',
].join('\n\n');

function root(): CatalogRoot {
  const prompt = createWorkspacePrompt({
    id: 'order-status',
    title: 'Order status',
    configuration: '',
    tool: 'lookup_order',
    variable: 'customer_message',
  });
  const heads = new Map([
    ['order-status', TEXT],
    [promptDesignProviderKey('order-status'), serializePromptDesign(prompt.design)],
  ]);
  return authoredPromptRootsFromHeads(heads).roots[0]!;
}

function surface(overrides: Partial<VerificationCommandSurface> = {}): VerificationCommandSurface & {
  proposals: CheckProposal[];
} {
  const proposals: CheckProposal[] = [];
  const open = root();
  return {
    loadedDocument: { rootId: 'order-status', text: TEXT },
    tree: parsePromptTree({ key: 'order-status', text: TEXT }),
    root: open,
    latest: null,
    runChecks: vi.fn(() => runRootVerification(open, TEXT)),
    semantic: { forSection: () => IDLE_REVIEW, statusBySectionId: {} },
    proposals,
    addProposal: vi.fn((proposal: CheckProposal) => proposals.push(proposal)),
    showChecks: vi.fn(() => true),
    newId: () => 'p1',
    ...overrides,
  };
}

function codeOf(run: () => unknown): string | undefined {
  try {
    run();
  } catch (error) {
    return error instanceof ControlCommandError ? error.code : 'not a ControlCommandError';
  }
  return undefined;
}

describe('listChecks / runChecks / getFindings', () => {
  it('lists saved checks for the whole prompt and every section', () => {
    // Given: the order-status prompt open
    const commands = buildVerificationCommands(surface());
    // When: the agent lists every scope, then only the tools section
    const all = commands.listChecks({ rootId: 'order-status' }) as { scopes: { sectionId: string | null }[] };
    const tools = commands.listChecks({ rootId: 'order-status', sectionId: 'tools' }) as {
      scopes: { sectionId: string; profiles: { automatic: { kind: string; state: string; origin: string }[] }[] }[];
    };
    // Then: the whole prompt comes first, then one scope per section; checks are saved with their origin
    expect(all.scopes.map((scope) => scope.sectionId)).toEqual([
      null,
      'order-status.role',
      'order-status.tools',
      'order-status.output',
    ]);
    expect(tools.scopes).toHaveLength(1);
    expect(tools.scopes[0]!.profiles[0]!.automatic).toContainEqual(
      expect.objectContaining({ kind: 'non-empty', state: 'saved', origin: 'authored' }),
    );
  });

  it('runs the automatic checks through Verify and reports a refused panel', () => {
    // Given: a tab where Verify opens, and one where the person keeps a panel draft
    const tab = surface();
    const refused = surface({ runChecks: vi.fn(() => null) });
    // When: the agent runs the checks
    const result = buildVerificationCommands(tab).runChecks({ rootId: 'order-status' }) as {
      counts: Record<string, number>;
      findings: unknown[];
    };
    // Then: the findings come back with counts; a refused panel is a failed command
    expect(tab.runChecks).toHaveBeenCalledTimes(1);
    expect(result.counts).toEqual(expect.objectContaining({ error: expect.any(Number) }));
    expect(codeOf(() => buildVerificationCommands(refused).runChecks({ rootId: 'order-status' }))).toBe(
      'command_failed',
    );
  });

  it('marks findings current, stale or none', () => {
    // Given: no run yet, then a stale run
    const open = root();
    const none = buildVerificationCommands(surface());
    const stale = buildVerificationCommands(
      surface({ latest: { result: runRootVerification(open, TEXT), freshness: 'stale' } }),
    );
    // When / Then: freshness is reported for the automatic findings and the AI review per scope
    expect(none.getFindings({ rootId: 'order-status' })).toMatchObject({ automatic: { freshness: 'none' } });
    const read = stale.getFindings({ rootId: 'order-status' }) as {
      automatic: { freshness: string };
      aiReview: { status: string; freshness: string }[];
    };
    expect(read.automatic.freshness).toBe('stale');
    expect(read.aiReview[0]).toMatchObject({ status: 'idle', freshness: 'not-checked' });
  });
});

describe('proposeCheck / getProposalStatus', () => {
  it('stores a rule proposal for the person, opens Checks on its scope, and never saves', () => {
    // Given: the order-status prompt open
    const tab = surface();
    const commands = buildVerificationCommands(tab);
    // When: the agent proposes a required-tool check for the tools section
    const proposed = commands.proposeCheck({
      rootId: 'order-status',
      sectionId: 'tools',
      kind: 'rule',
      rule: { kind: 'required-tool', name: 'lookup_order' },
    });
    // Then: it is "proposed", stored pending against the section profile, and Checks opens on that scope
    expect(proposed).toMatchObject({ proposalId: 'proposal-p1', status: 'proposed', sectionId: 'order-status.tools' });
    expect(tab.proposals[0]).toMatchObject({
      status: 'pending',
      scope: 'order-status.tools',
      kind: 'rule',
      rule: { id: 'agent-p1', kind: 'required-tool', name: 'lookup_order', severity: 'warning', enforcement: 'edit' },
    });
    expect(tab.showChecks).toHaveBeenCalledWith('order-status.tools');
    expect(commands.getProposalStatus({ proposalId: 'proposal-p1' })).toMatchObject({ status: 'pending' });
  });

  it('reads the decision back and refuses invalid proposals', () => {
    // Given: a criterion proposal the person then edited and saved
    const tab = surface();
    buildVerificationCommands(tab).proposeCheck({
      rootId: 'order-status',
      kind: 'criterion',
      statement: 'Never guess.',
    });
    const decided = resolveProposal(tab.proposals, 'proposal-p1', 'edited');
    const commands = buildVerificationCommands({ ...tab, proposals: decided });
    // When / Then: the status is "edited"; a bad rule, a missing statement or an unknown id is named
    expect(commands.getProposalStatus({ proposalId: 'proposal-p1' })).toMatchObject({
      status: 'edited',
      kind: 'criterion',
    });
    expect(tab.proposals[0]).toMatchObject({ scope: WHOLE_PROMPT });
    expect(
      codeOf(() => commands.proposeCheck({ rootId: 'order-status', kind: 'rule', rule: { kind: 'required-tool' } })),
    ).toBe('invalid_input');
    expect(codeOf(() => commands.proposeCheck({ rootId: 'order-status', kind: 'criterion' }))).toBe('invalid_input');
    expect(codeOf(() => commands.getProposalStatus({ proposalId: 'nope' }))).toBe('missing_target');
  });

  it('proposes nothing when Verify does not open', () => {
    // Given: the person keeps unsaved panel changes
    const tab = surface({ showChecks: vi.fn(() => false) });
    // When: the agent proposes a check
    const code = codeOf(() =>
      buildVerificationCommands(tab).proposeCheck({ rootId: 'order-status', kind: 'criterion', statement: 'x' }),
    );
    // Then: the command fails and no proposal exists
    expect(code).toBe('command_failed');
    expect(tab.addProposal).not.toHaveBeenCalled();
  });
});
