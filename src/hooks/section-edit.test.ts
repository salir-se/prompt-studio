// @vitest-environment node
// @module-tag pure
import { parsePromptTree, projectCanonicalPromptTree } from '@prompt-studio/prompts';
import { describe, expect, it } from 'vitest';
import { ensureSectionedTree } from '../catalog/prose-tree';
import { sectionEditBody, spliceSectionBody } from './section-edit';

const body = 'Intro.\n<first>\nRead.\n</first>\nBetween.\n<last>\nReply.\n</last>\nAfter.\n';

describe('#2521: section subtree source editing', () => {
  it.each([
    ['XML with interstitial and trailing prose', `<parent>\n${body}</parent>\n`, body],
    ['XML without an introduction', '<parent>\n<child>\nRead.\n</child>\n</parent>', '<child>\nRead.\n</child>\n'],
    ['empty XML body', '<parent>\n</parent>', ''],
    ['Markdown children', '# Parent\nIntro.\n## Child\nRead.\n# Sibling\nKeep.\n', 'Intro.\n## Child\nRead.\n'],
    [
      'numbered caps-label children',
      'PARENT:\nIntro.\n1. FIRST STEP:\nRead.\n2. LAST STEP:\nReply.\nNEXT:\nKeep.\n',
      'Intro.\n1. FIRST STEP:\nRead.\n2. LAST STEP:\nReply.\n',
    ],
    [
      'CRLF boundaries',
      '<parent>\r\n<child>\r\nRead.\r\n</child>\r\n</parent>\r\n',
      '<child>\r\nRead.\r\n</child>\r\n',
    ],
    ['prose fallback', 'Read the complete document.', 'Read the complete document.'],
  ])('reads and replaces the same range for %s', (_name, source, expectedBody) => {
    const section = ensureSectionedTree(parsePromptTree({ key: 'fixture', text: source })).children[0];
    const range = sectionEditBody(source, section)!;
    expect(range.text).toBe(expectedBody);
    expect(spliceSectionBody(source, section, range.text)).toBe(source);
    const nextBody = expectedBody.replace('Read.', 'Read carefully.');
    expect(spliceSectionBody(source, section, nextBody)).toBe(
      source.slice(0, range.start) + nextBody + source.slice(range.end),
    );
  });

  it('keeps canonical headings and XML wrappers outside the editable body', () => {
    const source = `Prefix.\n# Parent instructions\n<parent>\n${body}</parent>\n<outside>\nKeep.\n</outside>\nSuffix.`;
    const section = projectCanonicalPromptTree(parsePromptTree({ key: 'fixture', text: source }), [
      { tag: 'parent', heading: 'Parent instructions' },
    ]).children[0];
    expect(sectionEditBody(source, section)?.text).toBe(body);
    expect(spliceSectionBody(source, section, '')).toBe(source.replace(body, ''));
    expect(spliceSectionBody(source, section, 'A new instruction.')).toBe(source.replace(body, 'A new instruction.\n'));
  });

  it('locates a repeated introduction after its delimiter, never inside the tag name', () => {
    const source = '<parent>\nparent\n<child>\nRead.\n</child>\n</parent>';
    const section = parsePromptTree({ key: 'fixture', text: source }).children[0];
    expect(sectionEditBody(source, section)?.text).toBe('parent\n<child>\nRead.\n</child>\n');
  });

  it('refuses stale or invalid section ranges without changing source', () => {
    const source = `<parent>\n${body}</parent>`;
    const section = parsePromptTree({ key: 'fixture', text: source }).children[0];
    expect(spliceSectionBody(source, { ...section, text: 'Outdated introduction.' }, 'New.')).toBeNull();
    expect(spliceSectionBody(source, { ...section, range: { start: 0, end: 5 } }, 'New.')).toBeNull();
    expect(spliceSectionBody(source, { ...section, range: { start: -1, end: source.length + 1 } }, 'New.')).toBeNull();
  });
});
