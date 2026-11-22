// @module-tag dom
/**
 * BDD tests for ToolDefinitionNode.
 *
 * Behaviour contracts:
 *  - Renders the tool name as an accessible heading.
 *  - Shows a sky-tinted "tool" kind chip, matching the tool vocabulary.
 *  - Shows a `builtin` source badge for `source: 'builtin'`.
 *  - Shows a bare `mcp` source badge for `source: 'mcp'` with no `serverLabel`.
 *  - Shows `mcp · <serverLabel>` when `source: 'mcp'` and `serverLabel` is given.
 *  - Renders the description, clamped, when provided.
 *  - Renders no description paragraph at all when omitted (no empty artifact).
 *  - Renders one chip per entry in `inputKeys`.
 *  - Renders no input-keys row when `inputKeys` is omitted/empty.
 *  - Exposes selection via `data-selected` / `aria-current`, off by default.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ToolDefinitionNode } from './ToolDefinitionNode';

describe('ToolDefinitionNode', () => {
  it('renders the tool name as a heading', () => {
    render(<ToolDefinitionNode name="web_search" source="builtin" />);
    expect(screen.getByRole('heading', { name: 'web_search' })).toBeInTheDocument();
  });

  it('shows a sky-tinted "tool" kind chip', () => {
    render(<ToolDefinitionNode name="web_search" source="builtin" />);
    const chip = screen.getByText('tool');
    expect(chip).toBeInTheDocument();
    expect(chip.className).toMatch(/sky/);
  });

  it('shows a "builtin" source badge for builtin tools', () => {
    render(<ToolDefinitionNode name="web_search" source="builtin" />);
    expect(screen.getByText('builtin')).toBeInTheDocument();
  });

  it('shows a bare "mcp" source badge when no serverLabel is given', () => {
    render(<ToolDefinitionNode name="zai_web_search" source="mcp" />);
    expect(screen.getByText('mcp')).toBeInTheDocument();
  });

  it('shows "mcp · <serverLabel>" when serverLabel is given', () => {
    render(<ToolDefinitionNode name="zai_web_search" source="mcp" serverLabel="zai" />);
    expect(screen.getByText('mcp · zai')).toBeInTheDocument();
  });

  it('renders the description when provided', () => {
    render(
      <ToolDefinitionNode
        name="web_search"
        source="builtin"
        description="Search the web for delegation-readiness signals."
      />,
    );
    expect(screen.getByTestId('tool-definition-node-description')).toHaveTextContent(
      'Search the web for delegation-readiness signals.',
    );
  });

  it('renders no description paragraph when omitted', () => {
    render(<ToolDefinitionNode name="web_search" source="builtin" />);
    expect(screen.queryByTestId('tool-definition-node-description')).not.toBeInTheDocument();
  });

  it('renders a chip for every input key', () => {
    render(<ToolDefinitionNode name="web_search" source="builtin" inputKeys={['query', 'max_results']} />);
    expect(screen.getByText('query')).toBeInTheDocument();
    expect(screen.getByText('max_results')).toBeInTheDocument();
  });

  it('renders no input-keys row when inputKeys is omitted', () => {
    render(<ToolDefinitionNode name="web_search" source="builtin" />);
    expect(screen.queryByLabelText('Input keys')).not.toBeInTheDocument();
  });

  it('is not marked selected by default', () => {
    render(<ToolDefinitionNode name="web_search" source="builtin" />);
    expect(screen.getByTestId('tool-definition-node')).toHaveAttribute('data-selected', 'false');
  });

  it('marks the card selected via data-selected, aria-current, and a ring when selected is true', () => {
    render(<ToolDefinitionNode name="web_search" source="builtin" selected />);
    const card = screen.getByTestId('tool-definition-node');
    expect(card).toHaveAttribute('data-selected', 'true');
    expect(card).toHaveAttribute('aria-current', 'true');
    expect(card.className).toMatch(/ring-2/);
  });
});
