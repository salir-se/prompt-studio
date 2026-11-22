// @module-tag pure
import { createBlankPromptDesign } from '@prompt-studio/prompts';
import { describe, expect, it } from 'vitest';
import {
  authoredPromptRootsFromHeads,
  promptDesignProviderKey,
  serializePromptDesign,
} from '../design/prompt-design-project';
import { WORKFLOW_PATTERNS } from '../design/workflow-patterns';
import { runRootVerification } from '../panels/root-verification';
import { completionsAt, draftSections, insertDraftSection, instructionStep, sectionSelection } from './composing';
import { patternSteps } from './pattern-steps';

describe('contextual completion', () => {
  it('completes declared variables without duplicating a closing delimiter', () => {
    const text = 'Keep {{doc}} exactly';
    const [item] = completionsAt(text, 10, ['document'], []);
    expect(text.slice(0, item.from) + item.text + text.slice(item.to)).toBe('Keep {{document}} exactly');
  });
  it('offers the innermost unmatched closing tag, ignoring examples, attributes and comments', () => {
    const text = '<mission>\n```xml\n<fake>\n```\n<!-- <comment> -->\n<inner test=">">\n</';
    expect(completionsAt(text, text.length, [], []).map((x) => x.label)).toEqual(['</inner>', '</mission>']);
  });
  it.each(['```xml\n<mis', '---\nexample: <mis\n---', '`<mis', '<!-- <mis'])(
    'does not complete example syntax in %s',
    (text) => {
      const caret = text.indexOf('<mis') + 4;
      expect(completionsAt(text, caret, [], [])).toEqual([]);
    },
  );
  it('pairs a new tag but reuses an existing closing tag', () => {
    expect(completionsAt('<mission', 8, [], [])[0].text).toBe('<mission>\n\n</mission>');
    expect(completionsAt('<mission\ntext\n</mission>', 8, [], [])[0].text).toBe('<mission>');
    expect(completionsAt('x < y', 5, [], [])).toEqual([]);
  });
});

describe('draft structure edits', () => {
  it('inserts a real child in the dirty draft and selects its placeholder', () => {
    const text = '<mission>\nUnsaved instructions\n</mission>\n\n<output>\nKeep this.\n</output>';
    const sections = draftSections(text);
    const edit = insertDraftSection(text, sections[0], true, 'details');
    expect(edit.text).toContain('Unsaved instructions');
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe('Describe this section.');
    expect(draftSections(edit.text).map((n) => [n.title, n.depth])).toEqual([
      ['mission', 1],
      ['details', 2],
      ['output', 1],
    ]);
  });
  it('creates a true sibling for markdown sections and avoids colliding tags', () => {
    const text = '# Mission\nKeep.\n\n# Output\nFinal.';
    const edit = insertDraftSection(text, draftSections(text)[0], false, 'details');
    expect(draftSections(edit.text).map((n) => [n.title, n.depth])).toEqual([
      ['Mission', 1],
      ['details', 1],
      ['Output', 1],
    ]);
    const xml = '<details>\nExisting\n</details>';
    expect(insertDraftSection(xml, draftSections(xml)[0], true, 'details').text).toContain('<details_2>');
  });
  it('fills pattern steps as source sections and opens existing instructions without overwriting them', () => {
    const pattern = WORKFLOW_PATTERNS.find((p) => p.id === 'sequential')!;
    const step = instructionStep('', pattern.graph, 'draft');
    expect(step?.text).toContain('<step_sequential_draft>');
    const existing = step!.text.replace('Describe this section.', 'My instructions.');
    const again = instructionStep(existing, pattern.graph, 'draft');
    expect(again?.text).toBe(existing);
    expect(again?.text.slice(again.selectionStart, again.selectionEnd)).toBe('My instructions.');
    expect(instructionStep(existing, 'flowchart LR\n A --> B', 'draft')).toBeNull();
  });
});

it('replaces a complete token when the caret is inside its identifier', () => {
  for (const [text, caret, variables, tags, expected] of [
    ['{{document}}', 5, ['document'], [], '{{document}}'],
    ['<mission>\nBody\n</mission>', 4, [], ['mission'], '<mission>\nBody\n</mission>'],
  ] as const) {
    const item = completionsAt(text, caret, variables, tags)[0];
    expect(text.slice(0, item.from) + item.text + text.slice(item.to)).toBe(expected);
  }
});

it('selects body instructions even when they repeat the heading text', () => {
  const text = '# Mission\nMission';
  const edit = insertDraftSection(text, draftSections(text)[0], false, 'next');
  expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe('Describe this section.');
  const existing = '<step_sequential_draft>\nstep_sequential_draft\n</step_sequential_draft>';
  const selection = instructionStep(existing, WORKFLOW_PATTERNS.find((p) => p.id === 'sequential')!.graph, 'draft')!;
  expect(selection.selectionStart).toBe(existing.indexOf('\n') + 1);
});

describe('composing source preservation regressions', () => {
  it.each([
    ['{{document}}', 5, ['document'], [], '{{document}}'],
    ['<mission>', 4, [], ['mission'], '<mission>\n\n</mission>'],
  ] as const)('replaces the complete token when editing inside %s', (text, caret, variables, tags, expected) => {
    const item = completionsAt(text, caret, variables, tags)[0];
    expect(text.slice(0, item.from) + item.text + text.slice(item.to)).toBe(expected);
  });
  it('does not mistake an outer closing tag for the new nested tag closing', () => {
    const text = '<parent>\n<parent\n</parent>';
    const item = completionsAt(text, 16, [], ['parent'])[0];
    expect(item.text).toBe('<parent>\n\n</parent>');
  });
  it('does not suggest XML sections inside quoted attributes', () => {
    const text = '<tag attr="<mis';
    expect(completionsAt(text, text.length, [], [])).toEqual([]);
  });
  it('selects body content rather than the identical heading title', () => {
    const text = '# Mission\nMission';
    expect(sectionSelection(text, draftSections(text)[0]).selectionStart).toBe(10);
    const edit = insertDraftSection(text, draftSections(text)[0], true, 'details');
    expect(edit.text).toContain('# Mission\nMission');
  });
  it('selects the new placeholder when an earlier Markdown section has the same name', () => {
    const text = '# details\nKeep original\n\n# Mission\nTask';
    const edit = insertDraftSection(text, draftSections(text)[1], false, 'details');
    expect(edit.text).toContain('# details\nKeep original');
    expect(edit.text.slice(edit.selectionStart, edit.selectionEnd)).toBe('Describe this section.');
  });
  it.each(WORKFLOW_PATTERNS)('keeps $id steps as ordered peers without changing existing instructions', (pattern) => {
    const original = '# Mission\nKeep every byte.\n\n# Output\nFinal.';
    const guide = patternSteps(pattern.graph)!;
    let text = original;
    for (const step of [...guide.steps].reverse()) text = instructionStep(text, pattern.graph, step.id)!.text;
    expect(text.startsWith(original)).toBe(true);
    const sections = draftSections(text);
    const steps = sections.filter((section) => guide.steps.some((step) => step.tag === section.tag));
    expect(steps.map((section) => section.tag)).toEqual(guide.steps.map((step) => step.tag));
    expect(new Set(steps.map((section) => section.depth)).size).toBe(1);
    for (const step of guide.steps) expect(instructionStep(text, pattern.graph, step.id)?.text).toBe(text);
  });
});

it('jumps into an empty section body so typing cannot merge into its closing tag', () => {
  const text = '<context>\n\n</context>';
  const edit = sectionSelection(text, draftSections(text)[0]);
  expect(edit.selectionStart).toBe('<context>\n'.length);
  expect(`${text.slice(0, edit.selectionStart)}Instructions${text.slice(edit.selectionEnd)}`).toBe(
    '<context>\nInstructions\n</context>',
  );
});

it.each([
  ['MISSION: Write a short answer.\n\nOUTPUT: JSON only.', 0, 'Write a short answer.'],
  ['MISSION: Write a short answer.\n\nOUTPUT: JSON only.', 1, 'JSON only.'],
  [
    'MISSION: First instruction.\nContinue with evidence.\n\nOUTPUT: Final.',
    0,
    'First instruction.\nContinue with evidence.',
  ],
  ['MISSION: MISSION', 0, 'MISSION'],
  ['GROUPS:\n1. FIRST: Do first.\n2. SECOND: Do second.', 1, 'Do first.'],
  ['# Mission\nMission', 0, 'Mission'],
  ['<context>\n\n</context>', 0, ''],
  ['MISSION:', 0, ''],
] as const)('#2534: source selection stays inside the body of %s (section %i)', (text, index, expected) => {
  const section = draftSections(text)[index];
  const selection = sectionSelection(text, section);
  expect(text.slice(selection.selectionStart, selection.selectionEnd)).toBe(expected);
  const expectedStart = expected
    ? text.lastIndexOf(expected)
    : text === 'MISSION:'
      ? text.length
      : '<context>\n'.length;
  expect(selection.selectionStart).toBe(expectedStart);
  expect(selection.selectionEnd).toBeLessThanOrEqual(section.range.end);
  expect(selection.selectionEnd).toBeLessThanOrEqual(text.length);
  expect(selection.text).toBe(text);
});

it('verifies the newly authored workflow wrapper through its automatic non-empty check', () => {
  const created = createBlankPromptDesign({ id: 'composing', title: 'Composing' });
  const pattern = WORKFLOW_PATTERNS.find((item) => item.id === 'sequential')!;
  const text = instructionStep(created.text, pattern.graph, 'draft')!.text;
  const [root] = authoredPromptRootsFromHeads(
    new Map([
      ['composing', text],
      [promptDesignProviderKey('composing'), serializePromptDesign(created.design)],
    ]),
  ).roots;
  const result = runRootVerification(root, text)!;
  const wrapper = result.sections.find(
    (section) => section.sectionId === 'composing.workflow_instructions_sequential',
  )!;
  expect(wrapper.profile.deterministicRules).toContainEqual({
    id: 'non-empty',
    kind: 'non-empty',
    severity: 'error',
    enforcement: 'runtime',
  });
  expect(
    result.findings.filter(
      (finding) =>
        finding.source === 'deterministic' &&
        finding.ruleId === 'non-empty' &&
        finding.scope === 'section' &&
        finding.sectionId === wrapper.sectionId,
    ),
  ).toEqual([]);
  expect(wrapper.text).toContain('Follow these workflow instructions.');
  expect(text.startsWith(created.text)).toBe(true);
});

it('does not add new guidance to an existing empty workflow wrapper', () => {
  const pattern = WORKFLOW_PATTERNS.find((item) => item.id === 'sequential')!;
  const original = '<workflow_instructions_sequential>\n</workflow_instructions_sequential>';
  const edit = instructionStep(original, pattern.graph, 'draft')!;
  expect(draftSections(edit.text)[0].text).toBe('\n');
  expect(edit.text).not.toContain('Follow these workflow instructions.');
});

// #2512: a bare closing delimiter offers only tags that remain open at the caret.
describe('closing-tag completion at a bare </', () => {
  it.each([
    ['<outer>\n<inner>\n</', ['</inner>', '</outer>']],
    ['<outer>\n<inner>Done</inner>\n</', ['</outer>']],
    ['<outer>Done</outer>\n</', []],
    ['<outer>\n<child />\n</', ['</outer>']],
  ])('offers unmatched tags innermost first in %s', (text, labels) => {
    expect(completionsAt(text, text.length, [], []).map((item) => item.label)).toEqual(labels);
  });
  it('replaces an existing closing suffix without duplicating its >', () => {
    const text = '<outer>\n</outer>Tail';
    const [item] = completionsAt(text, text.indexOf('</') + 2, [], []);
    expect(text.slice(0, item.from) + item.text + text.slice(item.to)).toBe(text);
  });
});
