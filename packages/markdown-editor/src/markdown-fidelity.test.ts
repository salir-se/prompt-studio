// @module-tag dom
/**
 * The WYSIWYG editor re-serializes the whole document. These rules decide whether that output may replace the
 * author's text: escapes the serializer adds without changing the meaning are removed, and a document whose meaning
 * (or, where required, whose bytes) would change is reported so the editor opens it in Raw instead.
 */
import { describe, expect, it } from 'vitest';
import { createHeadlessMarkdown } from './exact-markdown';
import { measureFidelity, removeRedundantEscapes, visualKeepsText } from './markdown-fidelity';

const markdown = await createHeadlessMarkdown();
const { parse } = markdown;

describe('removeRedundantEscapes', () => {
  it('drops escapes that change nothing, so variables, tags and brackets keep their bytes', () => {
    // Given: serializer output with escapes the CommonMark parser does not need.
    const serialized = 'Hi {{product\\_name}}\n\n\\<critic\\_workflow>\n\n\\[CONFIRM WITH VENDOR: API format]\n';
    // When: the redundant escapes are removed.
    const cleaned = removeRedundantEscapes(serialized, parse);
    // Then: the text reads as the author typed it.
    expect(cleaned).toBe('Hi {{product_name}}\n\n<critic_workflow>\n\n[CONFIRM WITH VENDOR: API format]\n');
  });

  it('keeps an escape that stops emphasis or a link from forming', () => {
    // Given: escapes that protect literal asterisks and a literal link shape.
    const serialized = '\\*not emphasis\\* and \\[text](not-a-link)\n';
    // When: redundant escapes are removed.
    const cleaned = removeRedundantEscapes(serialized, parse);
    // Then: the text still means the same: no emphasis and no link formed.
    expect(measureFidelity(serialized, cleaned, parse)).not.toBe('changed');
    // And: the escape that stops the link is kept, and one asterisk escape is enough to stop the emphasis.
    expect(cleaned).toContain('\\[text](not-a-link)');
    expect(cleaned).toBe('*not emphasis\\* and \\[text](not-a-link)\n');
  });

  it('removes the right backslash after characters outside the Basic Multilingual Plane', () => {
    // Given: an emoji (two UTF-16 units) before an escape the parser does not need.
    const serialized = 'Ship it 🚀 for {{product\\_name}}\n';
    // When / Then: the escape goes and the emoji stays intact.
    expect(removeRedundantEscapes(serialized, parse)).toBe('Ship it 🚀 for {{product_name}}\n');
  });

  it('never touches a backslash inside code', () => {
    // Given: a code span and a code block that contain backslashes.
    const serialized = 'Use `a\\_b` here.\n\n```\nC:\\_dir\n```\n';
    // When / Then: code text is literal, so nothing is removed.
    expect(removeRedundantEscapes(serialized, parse)).toBe(serialized);
  });
});

describe('measureFidelity', () => {
  it('reports exact, equivalent or changed', () => {
    // Given / When / Then: identical bytes are exact.
    expect(measureFidelity('- a\n', '- a\n', parse)).toBe('exact');
    // And: a different bullet marker or an extra blank line keeps the meaning.
    expect(measureFidelity('## H\n- a\n', '## H\n\n* a\n', parse)).toBe('equivalent');
    // And: a list item that swallows the next line changes the meaning.
    expect(measureFidelity('- a\n\n</tag>\n', '- a\n  </tag>\n', parse)).toBe('changed');
  });
});

describe('visualKeepsText', () => {
  it('opens a field in Visual only when the round trip meets the field requirement', () => {
    // Given / When / Then: an exact field needs exact bytes.
    expect(visualKeepsText('exact', 'exact')).toBe(true);
    expect(visualKeepsText('equivalent', 'exact')).toBe(false);
    // And: a prose field accepts the same meaning in canonical Markdown.
    expect(visualKeepsText('equivalent', 'equivalent')).toBe(true);
    // And: nothing accepts a changed meaning.
    expect(visualKeepsText('changed', 'equivalent')).toBe(false);
  });
});
