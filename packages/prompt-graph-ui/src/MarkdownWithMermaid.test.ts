// @module-tag dom
import { render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { MarkdownWithMermaid, validateMermaidDiagram } from './MarkdownWithMermaid';

const fence = (lang: string, source: string) => ['```' + lang, source, '```'].join('\n');

describe('MarkdownWithMermaid', () => {
  it('renders prose and ordinary code through the same component', () => {
    render(
      createElement(MarkdownWithMermaid, {
        text: '# Heading\n\nSome *markdown* text.\n\n' + fence('ts', 'const x = 1;'),
      }),
    );
    expect(screen.getByRole('heading', { name: 'Heading' })).toBeInTheDocument();
    expect(screen.getByText('markdown').tagName).toBe('EM');
    expect(screen.getByText('const x = 1;').tagName).toBe('CODE');
    expect(screen.queryByTestId('mermaid-loading')).not.toBeInTheDocument();
  });

  it('renders multiple diagrams in document order alongside prose', async () => {
    const { container } = render(
      createElement(MarkdownWithMermaid, {
        text: [
          'Before.',
          fence('mermaid', 'graph TD;\nA-->B;'),
          'Middle.',
          fence('mermaid', 'sequenceDiagram\n  User->>Prompt: Start'),
          'After.',
        ].join('\n\n'),
      }),
    );
    const diagrams = await screen.findAllByRole('img', { name: 'Mermaid diagram' });
    expect(diagrams).toHaveLength(2);
    expect(new Set(diagrams.map((image) => image.getAttribute('src'))).size).toBe(2);
    expect(
      [...container.querySelectorAll('p, img')].map((node) => node.textContent || node.getAttribute('alt')),
    ).toEqual(['Before.', 'Mermaid diagram', 'Middle.', 'Mermaid diagram', 'After.']);
  });

  it('preserves source when a diagram fails to render', async () => {
    render(createElement(MarkdownWithMermaid, { text: 'Before.\n\n' + fence('mermaid', 'flowchart LR\n  A -->') }));
    const fallback = await screen.findByTestId('mermaid-error');
    expect(within(fallback).getByText(/failed to render/)).toBeInTheDocument();
    expect(fallback.querySelector('code')?.textContent).toBe('flowchart LR\n  A -->');
  });
});

describe('validateMermaidDiagram', () => {
  it('accepts any Mermaid diagram type and rejects syntax Mermaid cannot render', async () => {
    await expect(validateMermaidDiagram('sequenceDiagram\n  User->>Prompt: Start')).resolves.toEqual({ valid: true });

    await expect(validateMermaidDiagram('flowchart LR\n  A -->')).resolves.toMatchObject({ valid: false });
  });
});
