import type { BlockNode, MarkdownDocument, MarkdownExtension, ParseOptions } from '@tanstack/markdown';
import { autolinksExtension } from '@tanstack/markdown/extensions/autolinks';
import { streamingMarkdownExtension } from '@tanstack/markdown/extensions/streaming';
import { parseMarkdown as parse } from '@tanstack/markdown/parser';

export type { BlockNode, ComponentNode, InlineNode, MarkdownDocument, MarkdownExtension } from '@tanstack/markdown';

export interface MarkdownOptions {
  /** Reparse the accumulated response and suppress unfinished trailing markers. */
  streaming?: boolean;
  extensions?: readonly MarkdownExtension[];
  headingIds?: ParseOptions['headingIds'];
}

const autolinks = autolinksExtension();
const streaming = streamingMarkdownExtension();
export const streamingExtensions = [streaming];

export function parseMarkdown(source: string, options: MarkdownOptions = {}): MarkdownDocument {
  const extensions = [...(options.extensions ?? []), autolinks];
  if (options.streaming) extensions.push(streaming);
  return parse(source, { allowHtml: false, frontmatter: false, headingIds: options.headingIds, extensions });
}

/** Keep the existing line-per-paragraph layout of legal pages and changelogs. */
export const lineParagraphs: MarkdownExtension = {
  name: 'line-paragraphs',
  transformDocument(document) {
    document.children = document.children.flatMap<BlockNode>((block) => {
      if (block.type !== 'paragraph') return [block];

      const paragraphs: (typeof block)[] = [{ type: 'paragraph', children: [] }];
      let paragraph = paragraphs[0];
      for (const node of block.children) {
        if (node.type !== 'text' || !node.value.includes('\n')) {
          paragraph.children.push(node);
          continue;
        }

        const [first, ...lines] = node.value.split('\n');
        if (first) paragraph.children.push({ type: 'text', value: first });
        for (const value of lines) {
          paragraph = { type: 'paragraph', children: value ? [{ type: 'text', value }] : [] };
          paragraphs.push(paragraph);
        }
      }
      return paragraphs.filter(({ children }) => children.length > 0);
    });
  },
};
