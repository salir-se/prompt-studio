import { renderMermaidSvg } from './diagram-renderer';
import type { BlockNode, MarkdownDocument } from './document';

export { renderMermaidSvg } from './diagram-renderer';

export function diagramImageUrl(svg: string): string {
  return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

export async function validateMermaidDiagram(code: string): Promise<{ valid: true } | { valid: false; error: string }> {
  if (!code.trim()) return { valid: true };
  try {
    await renderMermaidSvg(code);
    return { valid: true };
  } catch (error) {
    return { valid: false, error: error instanceof Error ? error.message : String(error) };
  }
}

async function renderBlocks(blocks: BlockNode[]): Promise<BlockNode[]> {
  const rendered: BlockNode[] = [];
  for (const block of blocks) {
    switch (block.type) {
      case 'code':
        if (block.lang?.toLowerCase() === 'mermaid') {
          try {
            const src = diagramImageUrl(await renderMermaidSvg(block.value));
            rendered.push({ type: 'paragraph', children: [{ type: 'image', src, alt: 'Mermaid diagram' }] });
            continue;
          } catch {
            // Keep the source available when the diagram is incomplete or unsupported.
          }
        }
        break;
      case 'blockquote':
      case 'callout':
      case 'component':
        rendered.push({ ...block, children: await renderBlocks(block.children) });
        continue;
      case 'list':
      case 'footnotes': {
        const items = await Promise.all(
          block.items.map(async (item) => ({
            ...item,
            children: await renderBlocks(item.children),
          })),
        );
        if (block.type === 'list') {
          rendered.push({ ...block, items: items.filter((item) => 'type' in item) });
        } else {
          rendered.push({ ...block, items: items.filter((item) => 'number' in item) });
        }
        continue;
      }
    }
    rendered.push(block);
  }
  return rendered;
}

/** Static renderers embed diagram images without mutating the document. */
export async function withDiagrams(document: MarkdownDocument): Promise<MarkdownDocument> {
  return { ...document, children: await renderBlocks(document.children) };
}
