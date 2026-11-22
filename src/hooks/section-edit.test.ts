// @vitest-environment node
// @module-tag pure
import { parsePromptTree, projectCanonicalPromptTree } from '@prompt-studio/prompts';
import { describe, expect, it } from 'vitest';
import { ensureSectionedTree } from '../catalog/prose-tree';
import {
  findSectionNode,
  insertSectionText,
  sectionEditBody,
  sectionOwnBody,
  spliceSectionBody,
  spliceSectionOwnBody,
} from './section-edit';

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

describe('section commands: own-body splice and insert (roadmap #6)', () => {
  const order = [
    '<role>\nYou answer order-status questions.\n</role>',
    '<tools>\nCall lookup_order with {{order_id}}.\n<retry>\nRetry once.\n</retry>\n</tools>',
    '<output>\nReply with JSON.\n</output>',
  ].join('\n\n');
  const tree = () => parsePromptTree({ key: 'order-status', text: order });
  const node = (id: string) => findSectionNode(tree().children, id)!;

  it('replaces only the own body and leaves every other byte unchanged', () => {
    // Given: a prompt whose tools section has a nested retry section
    const tools = node('tools');
    // When: the tools section's own body is replaced without a trailing newline
    const next = spliceSectionOwnBody(order, tools, 'Call lookup_order once per message.')!;
    // Then: only the own-body range changed; the retry sub-section and the other sections are byte-identical
    const range = sectionOwnBody(order, tools)!;
    expect(range.text).toBe('Call lookup_order with {{order_id}}.\n');
    expect(next).toBe(`${order.slice(0, range.start)}Call lookup_order once per message.\n${order.slice(range.end)}`);
    const after = parsePromptTree({ key: 'order-status', text: next });
    expect(findSectionNode(after.children, 'tools/retry')!.text).toBe(node('tools/retry').text);
    expect(after.children.map((section) => section.id)).toEqual(['role', 'tools', 'output']);
  });

  it('keeps the closing tag on its own line for a leaf xml section', () => {
    // Given / When: the output section gets a body without a trailing newline
    const next = spliceSectionOwnBody(order, node('output'), 'Reply with {"status": "..."}')!;
    // Then: the closing tag still starts a line and the section parses with the new body
    expect(next.endsWith('<output>\nReply with {"status": "..."}\n</output>')).toBe(true);
    expect(
      sectionOwnBody(next, findSectionNode(parsePromptTree({ key: 'k', text: next }).children, 'output')!)?.text,
    ).toBe('Reply with {"status": "..."}\n');
  });

  it('inserts a sibling or a first child with a body and reports its id', () => {
    // Given: the role section as the anchor
    // When: a sibling "examples" with a body is inserted after it
    const sibling = insertSectionText(order, 'order-status', node('role'), 'after', 'examples', 'Order 42 → shipped.')!;
    // Then: the new section sits between role and tools with the given body
    const parsed = parsePromptTree({ key: 'order-status', text: sibling.text });
    expect(parsed.children.map((section) => section.id)).toEqual(['role', sibling.sectionId, 'tools', 'output']);
    expect(findSectionNode(parsed.children, sibling.sectionId)!.text.trim()).toBe('Order 42 → shipped.');
    // When: a first child is inserted under tools without a body
    const child = insertSectionText(order, 'order-status', node('tools'), 'firstChild', 'errors')!;
    // Then: it is the first sub-section of tools, with the placeholder line
    const tools = findSectionNode(parsePromptTree({ key: 'k', text: child.text }).children, 'tools')!;
    expect(tools.children.map((section) => section.id)).toEqual([child.sectionId, 'tools/retry']);
    expect(tools.children[0].text.trim()).toBe('Describe this section.');
  });
});
