// @module-tag pure
import { describe, expect, it } from 'vitest';
import { SUPPORT_PLAYBOOK_PROMPT, SUPPORT_PLAYBOOK_TOOLS } from '../test-fixtures/example-prompts';
import {
  derivePromptVerificationState,
  type PromptVerificationFinding,
  type PromptVerificationProfile,
} from '../verification-contracts';
import { runPromptVerificationProfile } from '../verification-profiles';
import { attributeFindingsToTree, nodeVerificationSummary } from './attribute-findings';
import { parsePromptTree } from './parse-tree';
import type { PromptTree, PromptTreeNode } from './types';

// ── Synthetic fixtures ───────────────────────────────────────────────────────

function makeNode(overrides: Partial<PromptTreeNode> & { id: string; title: string }): PromptTreeNode {
  return {
    delimiter: 'caps-label',
    depth: 1,
    text: '',
    range: { start: 0, end: 0 },
    variables: [],
    toolMentions: [],
    children: [],
    ...overrides,
  };
}

function makeTree(children: PromptTreeNode[]): PromptTree {
  return { key: 'synthetic', text: '', maxDepth: 1, children, tagClassifications: [], diagnostics: [] };
}

/** A non-section deterministic finding, matching the shape `evaluateRule` emits for consolidated profiles. */
function deterministicFinding(subject?: string, message = 'synthetic finding'): PromptVerificationFinding {
  return {
    scope: 'consolidated',
    source: 'deterministic',
    profile: { id: 'synthetic.profile', version: 1 },
    ruleId: 'synthetic-rule',
    severity: 'warning',
    enforcement: 'edit',
    message,
    ...(subject !== undefined ? { subject } : {}),
  };
}

/** A section-scoped deterministic finding — the shape per-section ADR-200 profiles will emit. */
function sectionFinding(sectionId: string): PromptVerificationFinding {
  return {
    scope: 'section',
    sectionId,
    source: 'deterministic',
    profile: { id: 'synthetic.section.profile', version: 1 },
    ruleId: 'synthetic-rule',
    severity: 'warning',
    enforcement: 'edit',
    message: 'synthetic section finding',
  };
}

/** A non-section semantic finding — carries no `subject`, so only rules 1 and 5 can ever apply. */
function semanticFinding(): PromptVerificationFinding {
  return {
    scope: 'consolidated',
    source: 'semantic',
    profile: { id: 'synthetic.profile', version: 1 },
    principleId: 'semantic-mission',
    severity: 'warning',
    message: 'synthetic semantic finding',
    evidenceQuote: 'quote',
    proposedCorrection: 'correction',
  };
}

describe('attributeFindingsToTree — synthetic trees', () => {
  it('attributes a section-scoped finding to the node whose id equals its sectionId (rule 1)', () => {
    const tree = makeTree([makeNode({ id: 'mission', title: 'YOUR MISSION' })]);
    const finding = sectionFinding('mission');

    const result = attributeFindingsToTree(tree, [finding]);

    expect(result.byNodeId.get('mission')).toEqual([finding]);
    expect(result.documentLevel).toEqual([]);
  });

  it('sends a section-scoped finding with an unknown sectionId to documentLevel (rule 5)', () => {
    const tree = makeTree([makeNode({ id: 'mission', title: 'YOUR MISSION' })]);
    const finding = sectionFinding('no-such-section');

    const result = attributeFindingsToTree(tree, [finding]);

    expect(result.byNodeId.size).toBe(0);
    expect(result.documentLevel).toEqual([finding]);
  });

  it('attributes a canonical section id through the caller supplied parsed-node mapping', () => {
    const tree = makeTree([makeNode({ id: 'scout-agent/candidate-validation', title: 'Candidate validation' })]);
    const finding = sectionFinding('scout.candidate-validation');

    const result = attributeFindingsToTree(tree, [finding], {
      'scout.candidate-validation': 'scout-agent/candidate-validation',
    });

    expect(result.byNodeId.get('scout-agent/candidate-validation')).toEqual([finding]);
    expect(result.documentLevel).toEqual([]);
  });

  it('attributes a variable subject to EVERY node declaring it, and never to documentLevel (rule 2)', () => {
    const tree = makeTree([
      makeNode({ id: 'a', title: 'A', variables: ['icp_text'] }),
      makeNode({ id: 'b', title: 'B' }),
      makeNode({ id: 'c', title: 'C', variables: ['icp_text', 'other'] }),
    ]);
    const finding = deterministicFinding('icp_text');

    const result = attributeFindingsToTree(tree, [finding]);

    expect([...result.byNodeId.keys()]).toEqual(['a', 'c']);
    // Same shared reference in each node's list.
    expect(result.byNodeId.get('a')?.[0]).toBe(finding);
    expect(result.byNodeId.get('c')?.[0]).toBe(finding);
    expect(result.documentLevel).toEqual([]);
  });

  it('strips a surrounding {{ }} wrapper from the subject before matching', () => {
    // `evaluateRule` emits bare names today; the braced form is producer
    // future-proofing (see normalizeSubject).
    const tree = makeTree([makeNode({ id: 'a', title: 'A', variables: ['icp_text'] })]);

    const result = attributeFindingsToTree(tree, [deterministicFinding('{{ icp_text }}')]);

    expect([...result.byNodeId.keys()]).toEqual(['a']);
    expect(result.documentLevel).toEqual([]);
  });

  it('attributes a tool subject to every node mentioning the tool (rule 3)', () => {
    const tree = makeTree([
      makeNode({ id: 'a', title: 'A', toolMentions: ['web_search'] }),
      makeNode({ id: 'b', title: 'B', toolMentions: ['save_lead'] }),
      makeNode({ id: 'c', title: 'C', toolMentions: ['web_search'] }),
    ]);
    const finding = deterministicFinding('web_search');

    const result = attributeFindingsToTree(tree, [finding]);

    expect([...result.byNodeId.keys()]).toEqual(['a', 'c']);
    expect(result.documentLevel).toEqual([]);
  });

  it('prefers a variable match over a tool match when the subject names both (rule 2 before rule 3)', () => {
    const tree = makeTree([
      makeNode({ id: 'as-variable', title: 'A', variables: ['ambiguous'] }),
      makeNode({ id: 'as-tool', title: 'B', toolMentions: ['ambiguous'] }),
    ]);

    const result = attributeFindingsToTree(tree, [deterministicFinding('ambiguous')]);

    expect([...result.byNodeId.keys()]).toEqual(['as-variable']);
  });

  it('falls back to a case-insensitive, trimmed title match (rule 4)', () => {
    const tree = makeTree([
      makeNode({ id: 'mission', title: '  YOUR MISSION ' }),
      makeNode({ id: 'other', title: 'OTHER' }),
    ]);
    const finding = deterministicFinding('your mission');

    const result = attributeFindingsToTree(tree, [finding]);

    expect([...result.byNodeId.keys()]).toEqual(['mission']);
    expect(result.documentLevel).toEqual([]);
  });

  it('sends a subject that matches no variable, tool, or title to documentLevel (rule 5)', () => {
    const tree = makeTree([makeNode({ id: 'a', title: 'A', variables: ['x'], toolMentions: ['y'] })]);
    const finding = deterministicFinding('minimum-length');

    const result = attributeFindingsToTree(tree, [finding]);

    expect(result.byNodeId.size).toBe(0);
    expect(result.documentLevel).toEqual([finding]);
  });

  it('sends a non-section semantic finding (which carries no subject) to documentLevel (rule 5)', () => {
    const tree = makeTree([makeNode({ id: 'a', title: 'A', variables: ['icp_text'] })]);
    const finding = semanticFinding();

    const result = attributeFindingsToTree(tree, [finding]);

    expect(result.byNodeId.size).toBe(0);
    expect(result.documentLevel).toEqual([finding]);
  });

  it('traverses nested children — a subject declared only on a grandchild lands on that grandchild', () => {
    const grandchild = makeNode({ id: 'root/child/leaf', title: 'LEAF', depth: 3, variables: ['deep_var'] });
    const child = makeNode({ id: 'root/child', title: 'CHILD', depth: 2, children: [grandchild] });
    const tree = makeTree([makeNode({ id: 'root', title: 'ROOT', children: [child] })]);

    const result = attributeFindingsToTree(tree, [deterministicFinding('deep_var'), sectionFinding('root/child')]);

    // byNodeId iterates in tree (preorder) order: child before its own leaf.
    expect([...result.byNodeId.keys()]).toEqual(['root/child', 'root/child/leaf']);
    expect(result.documentLevel).toEqual([]);
  });

  it('keys byNodeId in tree order regardless of findings order, and each list in findings order', () => {
    const tree = makeTree([
      makeNode({ id: 'first', title: 'FIRST', variables: ['shared', 'only_first'] }),
      makeNode({ id: 'second', title: 'SECOND', variables: ['shared'] }),
    ]);
    const onlyFirst = deterministicFinding('only_first');
    const sharedOne = deterministicFinding('shared', 'one');
    const sharedTwo = deterministicFinding('shared', 'two');

    // 'second' is hit before 'first' would be — tree order must still win.
    const result = attributeFindingsToTree(tree, [sharedOne, sharedTwo, onlyFirst]);

    expect([...result.byNodeId.keys()]).toEqual(['first', 'second']);
    expect(result.byNodeId.get('first')).toEqual([sharedOne, sharedTwo, onlyFirst]);
    expect(result.byNodeId.get('second')).toEqual([sharedOne, sharedTwo]);
  });

  it('returns an empty map and empty documentLevel for empty findings', () => {
    const tree = makeTree([makeNode({ id: 'a', title: 'A' })]);

    const result = attributeFindingsToTree(tree, []);

    expect(result.byNodeId.size).toBe(0);
    expect(result.documentLevel).toEqual([]);
  });
});

// ── Real findings from a consolidated verification profile ───────────────────
//
// Mirrors how the Verification panel invokes the runner: an explicit profile plus the
// known variables and tool names of the prompt under verification.

const playbookKnownVariables = ['company_name', 'queue_name'];
const playbookToolNames = [...SUPPORT_PLAYBOOK_TOOLS];
const playbookProfile: PromptVerificationProfile = {
  id: 'support-playbook.consolidated',
  version: 1,
  scope: 'consolidated',
  deterministicRules: [
    { id: 'non-empty', kind: 'non-empty', severity: 'error', enforcement: 'runtime' },
    {
      id: 'required-placeholder:queue_name',
      kind: 'required-placeholder',
      name: 'queue_name',
      severity: 'warning',
      enforcement: 'edit',
    },
    {
      id: 'known-placeholder',
      kind: 'known-placeholder',
      allowedNames: playbookKnownVariables,
      severity: 'warning',
      enforcement: 'edit',
    },
    {
      id: 'required-tool:search_tickets',
      kind: 'required-tool',
      name: 'search_tickets',
      severity: 'warning',
      enforcement: 'edit',
    },
  ],
  principles: [],
};

function runPlaybookVerification(text: string): readonly PromptVerificationFinding[] {
  return runPromptVerificationProfile(playbookProfile, text, {
    knownVariables: playbookKnownVariables,
    toolNames: playbookToolNames,
  });
}

function collectNodes(nodes: readonly PromptTreeNode[], out: PromptTreeNode[] = []): PromptTreeNode[] {
  for (const node of nodes) {
    out.push(node);
    collectNodes(node.children, out);
  }
  return out;
}

describe('attributeFindingsToTree — real profile findings', () => {
  const defaultTree = parsePromptTree({
    key: 'support-playbook',
    text: SUPPORT_PLAYBOOK_PROMPT,
    toolNames: playbookToolNames,
  });

  it('pins a required-placeholder finding onto the default-tree nodes that declare the variable', () => {
    // Given: an edit that strips {{queue_name}}, yielding a bare-name subject; the
    // DEFAULT tree still declares the variable, so the finding lands on the
    // section(s) that reference it (the "your edit removed this" UX).
    const mutated = SUPPORT_PLAYBOOK_PROMPT.replace('{{queue_name}}', '');
    // When: the profile runs on the edit and its findings are attributed to the default tree
    const findings = runPlaybookVerification(mutated).filter(
      (f) => f.source === 'deterministic' && f.ruleId === 'required-placeholder:queue_name',
    );
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding.source === 'deterministic' && finding.subject).toBe('queue_name'); // bare, no braces

    const result = attributeFindingsToTree(defaultTree, findings);

    // Then: every declaring node carries the finding and nothing stays document-level
    const declaringIds = collectNodes(defaultTree.children)
      .filter((node) => node.variables.includes('queue_name'))
      .map((node) => node.id);
    expect(declaringIds.length).toBeGreaterThan(0);
    expect([...result.byNodeId.keys()]).toEqual(declaringIds);
    for (const id of declaringIds) expect(result.byNodeId.get(id)).toEqual(findings);
    expect(result.documentLevel).toEqual([]);
  });

  it('pins a known-placeholder finding onto the mutated-tree node that declares the unknown variable', () => {
    // Given: an edit injecting an unresolvable placeholder, whose subject IS
    // present in the mutated tree — same-text tree and findings.
    const mutated = SUPPORT_PLAYBOOK_PROMPT.replace('{{queue_name}}', '{{queue_name}}\n{{made_up_variable}}');
    // When: the profile runs and the findings are attributed to the mutated tree
    const findings = runPlaybookVerification(mutated).filter(
      (f) => f.source === 'deterministic' && f.ruleId === 'known-placeholder',
    );
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding.source === 'deterministic' && finding.subject).toBe('made_up_variable');

    const mutatedTree = parsePromptTree({ key: 'support-playbook', text: mutated, toolNames: playbookToolNames });
    const result = attributeFindingsToTree(mutatedTree, findings);

    // Then: the finding lands on the declaring node(s) only

    const declaringIds = collectNodes(mutatedTree.children)
      .filter((node) => node.variables.includes('made_up_variable'))
      .map((node) => node.id);
    expect(declaringIds.length).toBeGreaterThan(0);
    expect([...result.byNodeId.keys()]).toEqual(declaringIds);
    expect(result.documentLevel).toEqual([]);
  });

  it('pins a required-tool finding onto the default-tree nodes that mention the tool', () => {
    // Given: an edit that no longer mentions the search_tickets tool
    const mutated = SUPPORT_PLAYBOOK_PROMPT.replaceAll('search_tickets', 'the ticket list');
    // When: the profile runs and the findings are attributed to the default tree
    const findings = runPlaybookVerification(mutated).filter(
      (f) => f.source === 'deterministic' && f.ruleId === 'required-tool:search_tickets',
    );
    expect(findings).toHaveLength(1);
    const [finding] = findings;
    expect(finding.source === 'deterministic' && finding.subject).toBe('search_tickets');

    const result = attributeFindingsToTree(defaultTree, findings);

    // Then: every node of the default tree that mentioned the tool carries the finding
    const mentioningIds = collectNodes(defaultTree.children)
      .filter((node) => node.toolMentions.includes('search_tickets'))
      .map((node) => node.id);
    expect(mentioningIds.length).toBeGreaterThan(0);
    expect([...result.byNodeId.keys()]).toEqual(mentioningIds);
    expect(result.documentLevel).toEqual([]);
  });
});

// ── nodeVerificationSummary ──────────────────────────────────────────────────
//
// State comes from the REAL derivePromptVerificationState with semanticStatus
// pinned to 'not-run'. That pin makes 'verified' and 'degraded' unreachable
// deterministically: 'verified' requires semanticStatus 'passed' and
// 'degraded' requires 'unavailable', neither of which a deterministic-only
// attribution pass can produce. Only 'invalid' | 'warning' | 'valid' occur.

function summaryFixture(
  severity: 'info' | 'warning' | 'error',
  enforcement: 'edit' | 'activation' | 'runtime',
): PromptVerificationFinding {
  return {
    scope: 'consolidated',
    source: 'deterministic',
    profile: { id: 'synthetic.profile', version: 1 },
    ruleId: 'synthetic-rule',
    severity,
    enforcement,
    message: 'synthetic finding',
  };
}

describe('nodeVerificationSummary', () => {
  it("returns 'valid' with count 0 for no findings", () => {
    expect(nodeVerificationSummary([])).toEqual({ state: 'valid', findingCount: 0 });
  });

  it("returns 'warning' for a warning finding", () => {
    const findings = [summaryFixture('warning', 'edit')];
    expect(nodeVerificationSummary(findings)).toEqual({ state: 'warning', findingCount: 1 });
  });

  it("returns 'warning' — not 'invalid' — for an edit-enforcement error", () => {
    // derivePromptVerificationState only escalates deterministic errors to
    // 'invalid' when enforcement is 'activation' or 'runtime'.
    const findings = [summaryFixture('error', 'edit')];
    expect(nodeVerificationSummary(findings)).toEqual({ state: 'warning', findingCount: 1 });
  });

  it("returns 'invalid' for activation- and runtime-enforcement errors", () => {
    expect(nodeVerificationSummary([summaryFixture('error', 'activation')]).state).toBe('invalid');
    expect(nodeVerificationSummary([summaryFixture('error', 'runtime')]).state).toBe('invalid');
  });

  it("always agrees with derivePromptVerificationState('not-run', findings)", () => {
    const cases: readonly PromptVerificationFinding[][] = [
      [],
      [summaryFixture('info', 'edit')],
      [summaryFixture('warning', 'edit')],
      [summaryFixture('error', 'edit')],
      [summaryFixture('error', 'runtime'), summaryFixture('warning', 'edit')],
      [semanticFinding()],
    ];
    for (const findings of cases) {
      const summary = nodeVerificationSummary(findings);
      expect(summary.state).toBe(derivePromptVerificationState('not-run', findings));
      expect(summary.findingCount).toBe(findings.length);
    }
  });
});
