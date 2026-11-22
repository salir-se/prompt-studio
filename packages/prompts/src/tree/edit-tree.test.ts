// @module-tag pure
/**
 * BDD tests for `edit-tree.ts` — every mutation is asserted by ROUND-TRIP
 * through the real parser (`parsePromptTree`), not by string inspection alone:
 * the whole point of ADR-202 §3 is that the text edit IS the graph edit, so
 * the proof that "add child" worked is that re-parsing the returned text
 * yields the new node in the right place in the tree.
 */

import { describe, expect, it } from 'vitest';
import {
  insertChildSection,
  insertSiblingSectionAfter,
  locateSection,
  moveSectionAmongSiblings,
  removeSectionText,
  uniqueSectionTagName,
  xmlSectionStub,
} from './edit-tree';
import { parsePromptTree } from './parse-tree';
import type { PromptTree, PromptTreeNode } from './types';

const DOC = [
  'Intro line before any section.',
  '',
  'MISSION:',
  'Find delegation-ready companies with {{icp_text}}.',
  '',
  'SEARCH STRATEGY:',
  'Use web_search across job boards.',
  '',
  '1. JOB BOARDS:',
  'Sweep the big five boards.',
  '',
  '2. NEWS SIGNALS:',
  'Funding + expansion announcements.',
  '',
  'HARD RULES:',
  'Never fabricate a signal.',
].join('\n');

function parse(text: string): PromptTree {
  return parsePromptTree({ key: 'scout', text, toolNames: ['web_search'] });
}

function byTitle(tree: PromptTree, title: string): PromptTreeNode {
  const stack: PromptTreeNode[] = [...tree.children];
  while (stack.length > 0) {
    const node = stack.shift() as PromptTreeNode;
    if (node.title === title) return node;
    stack.unshift(...node.children);
  }
  throw new Error(`no section titled ${title}`);
}

describe('locateSection', () => {
  it('finds a top-level section with a null parent and its top-level sibling list', () => {
    const tree = parse(DOC);
    const mission = byTitle(tree, 'MISSION');

    const location = locateSection(tree, mission.id);

    expect(location?.parent).toBeNull();
    expect(location?.siblings.map((sibling) => sibling.title)).toEqual(['MISSION', 'SEARCH STRATEGY', 'HARD RULES']);
    expect(location?.index).toBe(0);
  });

  it('finds a nested section with its real parent and nested sibling list', () => {
    const tree = parse(DOC);
    const news = byTitle(tree, 'NEWS SIGNALS');

    const location = locateSection(tree, news.id);

    expect(location?.parent?.title).toBe('SEARCH STRATEGY');
    expect(location?.siblings.map((sibling) => sibling.title)).toEqual(['JOB BOARDS', 'NEWS SIGNALS']);
    expect(location?.index).toBe(1);
  });

  it('returns null for an unknown id', () => {
    expect(locateSection(parse(DOC), 'nope')).toBeNull();
  });
});

describe('uniqueSectionTagName', () => {
  it('returns the base name when no tag uses it', () => {
    expect(uniqueSectionTagName(parse(DOC))).toBe('new_section');
  });

  it('suffixes past every taken candidate', () => {
    const doc = `<new_section>\nbody\n</new_section>\n\n<new_section_2>\nbody\n</new_section_2>`;
    expect(uniqueSectionTagName(parse(doc))).toBe('new_section_3');
  });
});

describe('removeSectionText', () => {
  it('removes a top-level section and its whole subtree, and re-parse shows it gone', () => {
    const tree = parse(DOC);
    const strategy = byTitle(tree, 'SEARCH STRATEGY');

    const next = removeSectionText(DOC, strategy);
    const reparsed = parse(next);

    expect(reparsed.children.map((child) => child.title)).toEqual(['MISSION', 'HARD RULES']);
    expect(next).not.toContain('JOB BOARDS');
    expect(next).not.toContain('NEWS SIGNALS');
  });

  it('caps the leftover seam at one blank line (no whitespace accretion)', () => {
    const tree = parse(DOC);
    const next = removeSectionText(DOC, byTitle(tree, 'SEARCH STRATEGY'));
    expect(next).not.toMatch(/\n{3,}/);
  });

  it('leaves untouched regions byte-identical', () => {
    const tree = parse(DOC);
    const next = removeSectionText(DOC, byTitle(tree, 'SEARCH STRATEGY'));
    expect(next.startsWith('Intro line before any section.')).toBe(true);
    expect(next).toContain('MISSION:\nFind delegation-ready companies with {{icp_text}}.');
    expect(next).toContain('HARD RULES:\nNever fabricate a signal.');
  });
});

describe('insertSiblingSectionAfter', () => {
  it("adds a sibling after a caps-label section, in the target's own dialect", () => {
    const tree = parse(DOC);
    const mission = byTitle(tree, 'MISSION');

    const next = insertSiblingSectionAfter(DOC, mission, 'follow_up');
    const reparsed = parse(next);

    // Grammar constraint (see `siblingSectionStub`): only a caps line can be a caps section's
    // sibling — an xml tag there would nest as MISSION's child instead.
    expect(reparsed.children.map((child) => child.title)).toEqual([
      'MISSION',
      'FOLLOW UP',
      'SEARCH STRATEGY',
      'HARD RULES',
    ]);
    expect(byTitle(reparsed, 'FOLLOW UP').delimiter).toBe('caps-label');
    expect(byTitle(reparsed, 'FOLLOW UP').depth).toBe(1);
  });

  it('adds an xml-tag sibling after an xml-tag section', () => {
    const doc = `<first>\nFirst body.\n</first>\n\n<second>\nSecond body.\n</second>`;
    const tree = parse(doc);
    const first = byTitle(tree, 'first');

    const next = insertSiblingSectionAfter(doc, first, 'inserted');
    const reparsed = parse(next);

    expect(reparsed.children.map((child) => child.title)).toEqual(['first', 'inserted', 'second']);
    expect(byTitle(reparsed, 'inserted').delimiter).toBe('xml-tag');
  });

  it('adds a numbered sibling after a numbered sub-label, within the same parent', () => {
    const tree = parse(DOC);
    const boards = byTitle(tree, 'JOB BOARDS');

    const next = insertSiblingSectionAfter(DOC, boards, 'extra_boards');
    const reparsed = parse(next);

    expect(byTitle(reparsed, 'SEARCH STRATEGY').children.map((child) => child.title)).toEqual([
      'JOB BOARDS',
      'EXTRA BOARDS',
      'NEWS SIGNALS',
    ]);
    expect(reparsed.children.map((child) => child.title)).toEqual(['MISSION', 'SEARCH STRATEGY', 'HARD RULES']);
  });

  it('adds an atx sibling after an atx heading, reusing its marker count', () => {
    const doc = `## Alpha\nAlpha body.\n\n## Omega\nOmega body.`;
    const tree = parse(doc);
    const alpha = byTitle(tree, 'Alpha');

    const next = insertSiblingSectionAfter(doc, alpha, 'inserted');
    const reparsed = parse(next);

    expect(next).toContain('## inserted');
    expect(reparsed.children.map((child) => child.title)).toEqual(['Alpha', 'inserted', 'Omega']);
  });

  it('inserts after the section SUBTREE, never between a parent and its children', () => {
    const tree = parse(DOC);
    const strategy = byTitle(tree, 'SEARCH STRATEGY');

    const next = insertSiblingSectionAfter(DOC, strategy, 'follow_up');
    const reparsed = parse(next);

    // The new sibling comes after both nested numbered sub-sections.
    const strategyAfter = byTitle(reparsed, 'SEARCH STRATEGY');
    expect(strategyAfter.children.map((child) => child.title)).toEqual(['JOB BOARDS', 'NEWS SIGNALS']);
    expect(reparsed.children.map((child) => child.title)).toEqual([
      'MISSION',
      'SEARCH STRATEGY',
      'FOLLOW UP',
      'HARD RULES',
    ]);
  });

  it('introduces no 3+ newline runs at either seam', () => {
    const tree = parse(DOC);
    const next = insertSiblingSectionAfter(DOC, byTitle(tree, 'MISSION'), 'follow_up');
    expect(next).not.toMatch(/\n{3,}/);
  });
});

describe('insertChildSection', () => {
  it('appends an xml-tag child under a caps-label parent (extent ends implicitly)', () => {
    const tree = parse(DOC);
    const mission = byTitle(tree, 'MISSION');

    const next = insertChildSection(DOC, mission, 'mission_notes');
    const reparsed = parse(next);

    const child = byTitle(reparsed, 'mission_notes');
    expect(child.delimiter).toBe('xml-tag');
    expect(byTitle(reparsed, 'MISSION').children.map((node) => node.title)).toEqual(['mission_notes']);
  });

  it('appends a child INSIDE an xml-tag parent, before its closing tag', () => {
    const doc = `<outer>\nOuter body.\n</outer>\n\nTAIL:\ntail body`;
    const tree = parse(doc);
    const outer = byTitle(tree, 'outer');

    const next = insertChildSection(doc, outer, 'inner');
    const reparsed = parse(next);

    expect(byTitle(reparsed, 'outer').children.map((node) => node.title)).toEqual(['inner']);
    expect(reparsed.children.map((node) => node.title)).toEqual(['outer', 'TAIL']);
  });

  it('inserts as the FIRST child when the parent already has caps/atx children', () => {
    // Grammar constraint (see `insertChildSection`'s doc): at the parent's extent END its last
    // caps child's frame is still open, so a stub there would nest one level too deep — the end
    // of the parent's OWN body is the one offset where the open frame is the parent itself.
    const tree = parse(DOC);
    const strategy = byTitle(tree, 'SEARCH STRATEGY');

    const next = insertChildSection(DOC, strategy, 'more_signals');
    const reparsed = parse(next);

    expect(byTitle(reparsed, 'SEARCH STRATEGY').children.map((node) => node.title)).toEqual([
      'more_signals',
      'JOB BOARDS',
      'NEWS SIGNALS',
    ]);
    // Nothing leaked to the top level, and the numbered sub-sections stayed siblings.
    expect(reparsed.children.map((node) => node.title)).toEqual(['MISSION', 'SEARCH STRATEGY', 'HARD RULES']);
  });
});

describe('moveSectionAmongSiblings', () => {
  it('moves a top-level section up past its previous sibling, subtree and all', () => {
    const tree = parse(DOC);
    const strategy = byTitle(tree, 'SEARCH STRATEGY');

    const next = moveSectionAmongSiblings(DOC, tree, strategy.id, 'up');
    expect(next).not.toBeNull();
    const reparsed = parse(next as string);

    expect(reparsed.children.map((child) => child.title)).toEqual(['SEARCH STRATEGY', 'MISSION', 'HARD RULES']);
    // The subtree moved intact.
    expect(byTitle(reparsed, 'SEARCH STRATEGY').children.map((child) => child.title)).toEqual([
      'JOB BOARDS',
      'NEWS SIGNALS',
    ]);
  });

  it('moves a nested section down within its own sibling list only', () => {
    const tree = parse(DOC);
    const boards = byTitle(tree, 'JOB BOARDS');

    const next = moveSectionAmongSiblings(DOC, tree, boards.id, 'down');
    expect(next).not.toBeNull();
    const reparsed = parse(next as string);

    expect(byTitle(reparsed, 'SEARCH STRATEGY').children.map((child) => child.title)).toEqual([
      'NEWS SIGNALS',
      'JOB BOARDS',
    ]);
    // Top level untouched.
    expect(reparsed.children.map((child) => child.title)).toEqual(['MISSION', 'SEARCH STRATEGY', 'HARD RULES']);
  });

  it('returns null at the boundaries (first up, last down) and for an unknown id', () => {
    const tree = parse(DOC);
    expect(moveSectionAmongSiblings(DOC, tree, byTitle(tree, 'MISSION').id, 'up')).toBeNull();
    expect(moveSectionAmongSiblings(DOC, tree, byTitle(tree, 'HARD RULES').id, 'down')).toBeNull();
    expect(moveSectionAmongSiblings(DOC, tree, 'nope', 'down')).toBeNull();
  });

  it('round-trips: moving down then up restores the exact original document', () => {
    const tree = parse(DOC);
    const mission = byTitle(tree, 'MISSION');

    const down = moveSectionAmongSiblings(DOC, tree, mission.id, 'down') as string;
    const downTree = parse(down);
    const restored = moveSectionAmongSiblings(down, downTree, byTitle(downTree, 'MISSION').id, 'up');

    expect(restored).toBe(DOC);
  });
});

describe('xmlSectionStub', () => {
  it('parses as a single xml-tag section with a placeholder body', () => {
    const tree = parse(xmlSectionStub('fresh'));
    expect(tree.children).toHaveLength(1);
    expect(tree.children[0].title).toBe('fresh');
    expect(tree.children[0].delimiter).toBe('xml-tag');
    expect(tree.children[0].text).toContain('Describe this section.');
  });
});

it('inserts children after a body that repeats its heading title', () => {
  const text = '# Mission\nMission';
  const next = insertChildSection(text, parse(text).children[0], 'details');
  expect(next.startsWith(text)).toBe(true);
  expect(parse(next).children[0].children[0].tag).toBe('details');
});
