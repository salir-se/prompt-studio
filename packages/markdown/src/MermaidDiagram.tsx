import DOMPurify from 'dompurify';
import { useEffect, useState } from 'react';
import { diagramImageUrl, renderMermaidSvg } from './diagrams';
import './markdown.css';

export { validateMermaidDiagram } from './diagrams';

export interface MermaidDiagramProps {
  code: string;
  label?: string;
}

type DiagramResult = { code: string; image: string } | { code: string; error: string };

export function MermaidDiagram({ code, label = 'Mermaid diagram' }: MermaidDiagramProps) {
  const [result, setResult] = useState<DiagramResult>();

  useEffect(() => {
    let active = true;
    renderMermaidSvg(code)
      .then((svg) => {
        if (!active) return;
        const safeSvg = DOMPurify.sanitize(svg, { USE_PROFILES: { svg: true, svgFilters: true } });
        // SVG images isolate document IDs and disable scripts and external resources.
        setResult({ code, image: diagramImageUrl(safeSvg) });
      })
      .catch((error: unknown) => {
        if (active) setResult({ code, error: error instanceof Error ? error.message : String(error) });
      });
    return () => {
      active = false;
    };
  }, [code]);

  if (result?.code !== code) {
    return (
      <pre className="tm-code" data-testid="mermaid-loading">
        <code>{code}</code>
      </pre>
    );
  }
  if ('error' in result) {
    return (
      <div className="markdown-diagram" data-testid="mermaid-error">
        <p>Mermaid diagram failed to render: {result.error}</p>
        <pre className="tm-code">
          <code>{code}</code>
        </pre>
      </div>
    );
  }
  return (
    <div className="markdown-diagram" data-testid="mermaid-diagram">
      <img src={result.image} alt={label} />
    </div>
  );
}
