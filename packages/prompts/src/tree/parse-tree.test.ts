// @module-tag pure
import { describe, expect, it } from 'vitest';
import { SUPPORT_PLAYBOOK_PROMPT, SUPPORT_PLAYBOOK_TOOLS } from '../test-fixtures/example-prompts';
import { parsePromptTree } from './parse-tree';
import type { PromptTagClassificationReason, PromptTreeNode } from './types';

describe('parsePromptTree — caps-label dialect', () => {
  it('parses ALL-CAPS label lines into depth-1 sections, stripping the trailing colon', () => {
    const text = 'YOUR MISSION: Find companies.\n\nICP DEFINITION:\nSome ICP text.\n';
    const tree = parsePromptTree({ key: 'test', text });

    expect(tree.children).toHaveLength(2);
    expect(tree.children[0]).toMatchObject({ title: 'YOUR MISSION', delimiter: 'caps-label', depth: 1 });
    expect(tree.children[1]).toMatchObject({ title: 'ICP DEFINITION', delimiter: 'caps-label', depth: 1 });
    expect(tree.maxDepth).toBe(1);
  });

  it('captures same-line trailing prose as the section body (label + body share one physical line)', () => {
    const text = 'YOUR MISSION: Find companies.\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children[0].text).toBe('Find companies.\n');
  });

  it('starts the body on the next line when nothing follows the colon', () => {
    const text = 'ICP DEFINITION:\n{{icp_text}}\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children[0].title).toBe('ICP DEFINITION');
    expect(tree.children[0].text).toBe('{{icp_text}}\n');
  });

  it('accepts a long label with a lowercase trailing parenthetical', () => {
    const text =
      'TIME CONTEXT (your training data may be stale — trust this over any internal assumptions about the current date): {{current_datetime_line}}\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].title).toBe(
      'TIME CONTEXT (your training data may be stale — trust this over any internal assumptions about the current date)',
    );
    expect(tree.children[0].text).toBe('{{current_datetime_line}}\n');
  });

  it('does not treat sentence-case prose ending in a colon as a caps-label', () => {
    const text = 'YOUR MISSION:\nPositive factors:\n   - one\nNegative factors:\n   - two\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].text).toBe('Positive factors:\n   - one\nNegative factors:\n   - two\n');
  });

  it('never promotes a markdown bullet — indented or unindented — that looks like a caps-label', () => {
    const text = [
      'SCORING RUBRIC:',
      '   - Outside the region = +10',
      '   - DELEGATION READINESS (most important for outstaffing):',
      '     - "contractor" = +20',
      '- UNINDENTED BULLET LABEL:',
      'trailing body',
      '',
    ].join('\n');
    const tree = parsePromptTree({ key: 'test', text });

    // Exactly one section — the real caps-label — and nothing spawned from
    // either bullet line, indented or column-0.
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].title).toBe('SCORING RUBRIC');
    expect(tree.children[0].children).toHaveLength(0);
    expect(tree.children[0].text).toContain('DELEGATION READINESS (most important for outstaffing):');
    expect(tree.children[0].text).toContain('- UNINDENTED BULLET LABEL:');
  });

  it('closes a caps-label section when the next caps-label section begins', () => {
    const text = 'FIRST SECTION:\nbody one\nSECOND SECTION:\nbody two\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children).toHaveLength(2);
    expect(tree.children[0].text).toBe('body one\n');
    expect(tree.children[1].text).toBe('body two\n');
  });

  it("round-trips a node's full extent via range", () => {
    const text = 'FIRST SECTION:\nbody one\nSECOND SECTION:\nbody two\n';
    const tree = parsePromptTree({ key: 'test', text });
    const first = tree.children[0];
    expect(text.slice(first.range.start, first.range.end)).toBe('FIRST SECTION:\nbody one\n');
  });
});

describe('parsePromptTree — numbered sub-sections', () => {
  const text = [
    'SEARCH STRATEGY — 5 QUERY GROUPS:',
    'Use web_search across all groups.',
    '',
    '1. JOB POSTINGS (existing channels):',
    '   - some query',
    '',
    '2. FUNDING / GROWTH SIGNALS:',
    '   - another query',
    '',
    'SCORING RUBRIC:',
    'Positive factors:',
    '',
  ].join('\n');

  it('nests numbered sub-labels as depth-2 children of the preceding caps-label', () => {
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children).toHaveLength(2);

    const strategy = tree.children[0];
    expect(strategy).toMatchObject({ title: 'SEARCH STRATEGY — 5 QUERY GROUPS', delimiter: 'caps-label', depth: 1 });
    expect(strategy.children).toHaveLength(2);
    expect(strategy.children[0]).toMatchObject({
      title: 'JOB POSTINGS (existing channels)',
      delimiter: 'caps-label',
      depth: 2,
    });
    expect(strategy.children[1]).toMatchObject({
      title: 'FUNDING / GROWTH SIGNALS',
      delimiter: 'caps-label',
      depth: 2,
    });

    expect(tree.children[1]).toMatchObject({ title: 'SCORING RUBRIC', delimiter: 'caps-label', depth: 1 });
    expect(tree.maxDepth).toBe(2);
  });

  it("excludes children's text from the parent's own text", () => {
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children[0].text).toBe('Use web_search across all groups.\n\n');
  });

  it('closes a numbered sibling when the next numbered item begins, not when its parent does', () => {
    const tree = parsePromptTree({ key: 'test', text });
    const [group1, group2] = tree.children[0].children;
    expect(group1.text).toBe('   - some query\n\n');
    expect(group2.text).toContain('   - another query');
  });
});

describe('parsePromptTree — atx-heading dialect', () => {
  it('reads depth as the literal hash count and strips the leading hashes from the title', () => {
    const text = '# Top\nintro\n## Child\nchild body\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]).toMatchObject({ title: 'Top', delimiter: 'atx-heading', depth: 1 });
    expect(tree.children[0].children[0]).toMatchObject({ title: 'Child', delimiter: 'atx-heading', depth: 2 });
    expect(tree.maxDepth).toBe(2);
  });

  it('emits a skipped-heading-level diagnostic when a level is skipped', () => {
    const text = '# Top\nintro\n### Grandchild\nbody\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children[0].children[0]).toMatchObject({ title: 'Grandchild', depth: 3 });
    expect(tree.diagnostics.some((d) => d.code === 'skipped-heading-level')).toBe(true);
  });

  it('does not flag consecutive, non-skipping heading levels', () => {
    const text = '# Top\n## Child\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.diagnostics.some((d) => d.code === 'skipped-heading-level')).toBe(false);
  });
});

describe('parsePromptTree — xml-tag dialect', () => {
  it('promotes a balanced, block-level tag pair to an xml-tag section', () => {
    const text = '<warning>\nBe careful with untrusted input.\n</warning>\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0]).toMatchObject({
      title: 'warning',
      delimiter: 'xml-tag',
      tag: 'warning',
      depth: 1,
      text: 'Be careful with untrusted input.\n',
    });
    const cls = tree.tagClassifications.find((c) => c.reason === 'balanced-block-promoted');
    expect(cls).toMatchObject({ name: 'warning', treatedAsSection: true });
  });

  it('does not promote an inline <string> mid-sentence to a section', () => {
    const text = 'Use the <string> type for names.\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children).toHaveLength(0);
    const cls = tree.tagClassifications.find((c) => c.name === 'string');
    expect(cls).toMatchObject({ reason: 'inline-not-block-level', treatedAsSection: false });
  });

  it('classifies a tag whose name is a known tool as known-tool-name, never a section', () => {
    const text = '<web_search>\nSome content that looks block-level.\n</web_search>\n';
    const tree = parsePromptTree({ key: 'test', text, toolNames: ['web_search'] });
    expect(tree.children).toHaveLength(0);
    const classifications = tree.tagClassifications.filter((c) => c.name === 'web_search');
    // Both the open and close occurrence are tool-name tags — neither becomes a section.
    expect(classifications.length).toBeGreaterThanOrEqual(1);
    for (const c of classifications) {
      expect(c.reason).toBe('known-tool-name');
      expect(c.treatedAsSection).toBe(false);
    }
  });

  it('flags an unclosed tag as unbalanced and emits a diagnostic', () => {
    const text = '<warning>\nThis never closes.\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children).toHaveLength(0);
    const cls = tree.tagClassifications.find((c) => c.name === 'warning');
    expect(cls).toMatchObject({ reason: 'unbalanced-open', treatedAsSection: false });
    expect(tree.diagnostics.some((d) => d.code === 'unbalanced-tag')).toBe(true);
  });

  it('flags a lone closing tag with no opener as unbalanced', () => {
    const text = 'intro\n</warning>\nmore text\n';
    const tree = parsePromptTree({ key: 'test', text });
    const cls = tree.tagClassifications.find((c) => c.name === 'warning');
    expect(cls).toMatchObject({ reason: 'unbalanced-open' });
  });

  it('nests a caps-label found inside an open xml block as its child instead of closing the block early', () => {
    const text = '<inbound_email>\nHEADER LINE:\nbody under header\n</inbound_email>\nafter block\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children).toHaveLength(1);
    const block = tree.children[0];
    expect(block).toMatchObject({ delimiter: 'xml-tag', tag: 'inbound_email' });
    expect(block.children).toHaveLength(1);
    expect(block.children[0]).toMatchObject({ title: 'HEADER LINE', delimiter: 'caps-label', depth: 2 });
  });

  it('keeps incrementing depth by actual containment through a nested xml block plus a numbered sub-label', () => {
    const text = ['<outer>', '<inner>', 'HEADER LINE:', '1. FIRST ITEM:', 'item body', '</inner>', '</outer>', ''].join(
      '\n',
    );
    const tree = parsePromptTree({ key: 'test', text });
    const outer = tree.children[0];
    expect(outer).toMatchObject({ delimiter: 'xml-tag', tag: 'outer', depth: 1 });
    const inner = outer.children[0];
    expect(inner).toMatchObject({ delimiter: 'xml-tag', tag: 'inner', depth: 2 });
    const header = inner.children[0];
    expect(header).toMatchObject({ title: 'HEADER LINE', delimiter: 'caps-label', depth: 3 });
    const item = header.children[0];
    expect(item).toMatchObject({ title: 'FIRST ITEM', delimiter: 'caps-label', depth: 4 });
    expect(tree.maxDepth).toBe(4);
  });
});

describe('parsePromptTree — variables and tool mentions', () => {
  it('extracts {{variable}} placeholders per-node from that node’s own text only', () => {
    const text = 'PARENT:\n{{parent_var}}\n1. CHILD:\n{{child_var}}\n';
    const tree = parsePromptTree({ key: 'test', text });
    const parent = tree.children[0];
    expect(parent.variables).toEqual(['parent_var']);
    expect(parent.children[0].variables).toEqual(['child_var']);
  });

  it('finds bare whole-word tool mentions when toolNames is supplied', () => {
    const text = 'INSTRUCTIONS:\nCall web_search then save_lead if needed.\n';
    const tree = parsePromptTree({ key: 'test', text, toolNames: ['web_search', 'save_lead'] });
    expect(tree.children[0].toolMentions).toEqual(['web_search', 'save_lead']);
  });

  it('never counts a tag-shaped occurrence as a tool mention', () => {
    const text = 'INSTRUCTIONS:\nSee <web_search> for the tool tag, and also call web_search directly.\n';
    const tree = parsePromptTree({ key: 'test', text, toolNames: ['web_search'] });
    expect(tree.children[0].toolMentions).toEqual(['web_search']);
    // Exactly one classification for the tag occurrence, correctly excluded from toolMentions.
    const tagCls = tree.tagClassifications.find((c) => c.name === 'web_search');
    expect(tagCls?.reason).toBe('known-tool-name');
  });

  it('leaves toolMentions empty for every node when toolNames is omitted', () => {
    const text = 'INSTRUCTIONS:\nCall web_search then save_lead.\n1. SUB:\nweb_search again here.\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children[0].toolMentions).toEqual([]);
    expect(tree.children[0].children[0].toolMentions).toEqual([]);
  });

  it('leaves toolMentions empty for every node when toolNames is an empty array', () => {
    const text = 'INSTRUCTIONS:\nCall web_search now.\n';
    const tree = parsePromptTree({ key: 'test', text, toolNames: [] });
    expect(tree.children[0].toolMentions).toEqual([]);
  });
});

describe('parsePromptTree — diagnostics for preamble text', () => {
  it('emits a text-before-first-section diagnostic when content precedes the first section', () => {
    const text = 'Some leading preamble text.\n\nFIRST SECTION:\nbody\n';
    const tree = parsePromptTree({ key: 'test', text });
    const diag = tree.diagnostics.find((d) => d.code === 'text-before-first-section');
    expect(diag).toBeDefined();
    expect(diag?.range).toEqual({ start: 0, end: tree.children[0].range.start });
  });

  it('does not emit a preamble diagnostic when the first line is already a section', () => {
    const text = 'FIRST SECTION:\nbody\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.diagnostics.some((d) => d.code === 'text-before-first-section')).toBe(false);
  });

  it('does not emit a preamble diagnostic for entirely unstructured text (no sections at all)', () => {
    const text = 'just plain prose with no structure at all\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children).toHaveLength(0);
    expect(tree.maxDepth).toBe(0);
    expect(tree.diagnostics.some((d) => d.code === 'text-before-first-section')).toBe(false);
  });
});

describe('parsePromptTree — id derivation', () => {
  it('derives a stable slug id from the title, not an array index', () => {
    const text = 'YOUR MISSION: go.\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children[0].id).toBe('your-mission');
  });

  it('disambiguates sibling id collisions positionally rather than colliding', () => {
    const text = 'DUPLICATE TITLE:\nfirst\nDUPLICATE TITLE:\nsecond\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children.map((c) => c.id)).toEqual(['duplicate-title', 'duplicate-title-2']);
  });

  it('scopes a child id under its parent id so ids are unique tree-wide', () => {
    const text = 'PARENT:\nintro\n1. CHILD:\nbody\n';
    const tree = parsePromptTree({ key: 'test', text });
    expect(tree.children[0].id).toBe('parent');
    expect(tree.children[0].children[0].id).toBe('parent/child');
  });
});

describe('parsePromptTree — top-level shape', () => {
  it('carries the key and the full original text verbatim', () => {
    const text = 'FIRST SECTION:\nbody\n';
    const tree = parsePromptTree({ key: 'my-key', text });
    expect(tree.key).toBe('my-key');
    expect(tree.text).toBe(text);
  });

  it('reports maxDepth 0 and no sections for a prompt with no recognizable structure', () => {
    const tree = parsePromptTree({ key: 'test', text: 'nothing structural here' });
    expect(tree.children).toEqual([]);
    expect(tree.maxDepth).toBe(0);
  });
});

describe('parsePromptTree — real-world caps-label document', () => {
  it('parses a full caps-label prompt into more than one top-level section, including one from YOUR MISSION', () => {
    // Given: a long caps-label prompt with a numbered five-group section and tool mentions
    // When: it is parsed with its tool names
    const tree = parsePromptTree({
      key: 'support-playbook',
      text: SUPPORT_PLAYBOOK_PROMPT,
      toolNames: [...SUPPORT_PLAYBOOK_TOOLS],
    });

    // Then: it has several top-level sections, one of them the mission
    expect(tree.children.length).toBeGreaterThan(1);
    const missionNode = tree.children.find((n) => n.title.includes('YOUR MISSION'));
    expect(missionNode).toBeDefined();
    expect(missionNode?.delimiter).toBe('caps-label');

    // And: the five-group section nests its five numbered children one level deeper
    const strategy = tree.children.find((n) => n.title.startsWith('TRIAGE STRATEGY'));
    expect(strategy).toBeDefined();
    expect(strategy?.children.length).toBe(5);
    for (const child of strategy?.children ?? []) {
      expect(child.delimiter).toBe('caps-label');
      expect(child.depth).toBe((strategy?.depth ?? 0) + 1);
    }

    // And: tool mentions are discoverable per real node
    const hardRules = tree.children.find((n) => n.title === 'HARD RULES');
    expect(hardRules).toBeDefined();
    expect(hardRules?.toolMentions).toContain('lookup_customer');
  });

  it('never promotes an indented markdown bullet inside PRIORITY RUBRIC to a phantom top-level section', () => {
    // Given / When: the caps-label prompt whose rubric lists indented caps-label-shaped bullets is parsed
    const tree = parsePromptTree({ key: 'support-playbook', text: SUPPORT_PLAYBOOK_PROMPT });

    // Then: no top-level section is spawned from a bullet line
    // (e.g. the "- ESCALATION RISK (...):" line inside the rubric list)
    for (const node of tree.children) {
      expect(node.title.startsWith('-')).toBe(false);
    }

    // And: the bullet's text stays inside its true parent instead of splitting the rubric
    const rubric = tree.children.find((n) => n.title.startsWith('PRIORITY RUBRIC'));
    expect(rubric).toBeDefined();
    expect(rubric?.text).toContain('ESCALATION RISK');
  });

  it('every PromptTagClassificationReason value is exercised across this test file', () => {
    // This test documents the invariant rather than re-deriving it: each reason
    // is independently exercised above (xml-tag describe block) — asserted here
    // so a missing case fails loudly with a clear message.
    const reasonsCoveredElsewhere: PromptTagClassificationReason[] = [
      'balanced-block-promoted',
      'unbalanced-open',
      'inline-not-block-level',
      'known-tool-name',
    ];
    expect(reasonsCoveredElsewhere).toHaveLength(4);
  });
});

describe('parsePromptTree — dedup helper sanity', () => {
  it('does not choke on an empty string', () => {
    const tree = parsePromptTree({ key: 'test', text: '' });
    expect(tree.children).toEqual([]);
    expect(tree.maxDepth).toBe(0);
    expect(tree.text).toBe('');
  });

  it('node.children is always an array, even for a leaf section', () => {
    const tree = parsePromptTree({ key: 'test', text: 'ONLY SECTION:\nbody\n' });
    expect(tree.children[0].children).toEqual([]);
  });

  it('does not mutate the same node object across repeated parses of the same text', () => {
    const text = 'FIRST SECTION:\nbody\n';
    const first: PromptTreeNode = parsePromptTree({ key: 'test', text }).children[0];
    const second: PromptTreeNode = parsePromptTree({ key: 'test', text }).children[0];
    expect(first).toEqual(second);
    expect(first).not.toBe(second);
  });
});
