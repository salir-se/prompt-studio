// @module-tag pure
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';
import { withDiagrams } from './diagrams';
import { parseMarkdown } from './document';

const source = [
  '# Contents',
  '',
  '| Format | Supported |',
  '| --- | --- |',
  '| **JSON** | Yes |',
  '',
  '```json',
  '{"ready":true}',
  '```',
  '',
  '```yml',
  'ready: true',
  '```',
  '',
  '<script>alert(1)</script>',
  '[Bad link](javascript:alert%281%29)',
  '[Good link](https://example.com)',
].join('\n');

describe('Markdown document rendering', () => {
  it('renders the same safe technical content from a document after a JSON round trip', () => {
    // Given: a parsed document with a table, highlighted code, a script tag and an unsafe link
    const parsed = parseMarkdown(source);

    // When: the document crosses a JSON boundary and is rendered with React
    const document = JSON.parse(JSON.stringify(parsed));
    const html = renderToStaticMarkup(<Markdown source={document} />);

    // Then: the round trip is lossless and the rendered output is identical to the original document's
    expect(JSON.stringify(document)).toBe(JSON.stringify(parseMarkdown(source)));
    expect(html).toBe(renderToStaticMarkup(<Markdown source={parsed} />));
    // And: headings, tables and highlighted code render, while the script and javascript: link do not
    expect(html).toContain('id="contents"');
    expect(html).toContain('<strong>JSON</strong>');
    expect(html).toContain('<table');
    expect(html).toContain('class="language-json"');
    expect(html).toContain('class="language-yml"');
    expect(html.match(/th-property/g)).toHaveLength(2);
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="https://example.com"');
  });

  it('embeds a standalone diagram as a deterministic SVG image without mutating the document', async () => {
    // Given: a document holding one mermaid code block
    const document = parseMarkdown('```mermaid\nflowchart LR\n  Start --> Finish\n```');

    // When: diagrams are rendered for a static renderer, twice
    const first = await withDiagrams(document);
    const second = await withDiagrams(document);

    // Then: both renders are identical, carry an SVG data URL naming the node, and the source document is unchanged
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
    const imageUrl = JSON.stringify(first).match(/data:image\/svg\+xml,[^"\\]+/)?.[0];
    expect(imageUrl).toBeDefined();
    const svg = decodeURIComponent(imageUrl ?? '');
    expect(svg).toContain('Finish');
    expect(svg).toContain('--pele-line:light-dark(#7047ff,#a98cff)');
    expect(document.children[0].type).toBe('code');
  });

  it('reparses the full response independently for every streaming update', () => {
    // Given / When: an incomplete heading is parsed in streaming mode, then the complete response
    const partial = parseMarkdown('Started.\n\n##', { streaming: true });
    const complete = 'Started.\n\n## Finished';

    // Then: the dangling heading marker is held back while streaming, and a complete response parses the same
    expect(partial.children.map((block) => block.type)).toEqual(['paragraph']);
    expect(parseMarkdown(complete, { streaming: true })).toEqual(parseMarkdown(complete));
    expect(parseMarkdown('Started.\n\n##').children.map((block) => block.type)).toEqual(['paragraph', 'heading']);
  });
});
