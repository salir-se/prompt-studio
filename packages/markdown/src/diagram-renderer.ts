import { peleRenderer } from './pele-renderer';

/** Convert Mermaid source into deterministic, self-contained SVG without fetching external content. */
export type DiagramRenderer = (source: string) => Promise<string>;

export const renderMermaidSvg: DiagramRenderer = peleRenderer;
