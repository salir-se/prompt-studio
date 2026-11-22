// @module-tag dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { FragmentNode } from './FragmentNode';

describe('FragmentNode', () => {
  // ── verification (ADR-202 Stage D: per-node state border + finding-count chip) ──

  it('renders no verification treatment when verification is omitted (default-off)', () => {
    render(
      <FragmentNode title="Unverified" delimiter="caps-label" depth={1} text="body" variables={[]} toolMentions={[]} />,
    );
    const card = screen.getByRole('article', { name: 'Unverified' });
    expect(card).not.toHaveAttribute('data-verification-state');
    expect(card.className).toMatch(/\bborder-border\b/);
    expect(screen.queryByTestId('fragment-node-finding-count')).not.toBeInTheDocument();
  });

  it('keeps the default border for the "valid" state and names it in the accessible label', () => {
    render(
      <FragmentNode
        title="Valid Section"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        verification={{ state: 'valid', findingCount: 0 }}
      />,
    );
    const card = screen.getByRole('article', { name: 'Valid Section — verification: valid' });
    expect(card).toHaveAttribute('data-verification-state', 'valid');
    expect(card.className).toMatch(/\bborder-border\b/);
    expect(card.className).not.toMatch(/border-emerald|border-amber|border-destructive|border-dashed/);
  });

  it.each([
    ['verified', /\bborder-emerald-600\b.*\bdark:border-emerald-400\b/],
    ['warning', /\bborder-amber-500\b.*\bdark:border-amber-400\b/],
    ['invalid', /\bborder-destructive\b/],
    ['degraded', /\bborder-dashed\b.*\bborder-muted-foreground\/50\b/],
  ] as const)('renders the %s state border treatment', (state, expectedClasses) => {
    render(
      <FragmentNode
        title="Stateful Section"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        verification={{ state, findingCount: 0 }}
      />,
    );
    const card = screen.getByRole('article', { name: `Stateful Section — verification: ${state}` });
    expect(card).toHaveAttribute('data-verification-state', state);
    expect(card.className).toMatch(expectedClasses);
    // tailwind-merge must have dropped the conflicting default border colour.
    expect(card.className).not.toMatch(/\bborder-border\b/);
  });

  it('renders a singular "1 finding" chip titled with the state when findingCount is 1', () => {
    render(
      <FragmentNode
        title="One Finding"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        verification={{ state: 'warning', findingCount: 1 }}
      />,
    );
    const chip = screen.getByTestId('fragment-node-finding-count');
    expect(chip).toHaveTextContent('1 finding');
    expect(chip).not.toHaveTextContent('findings');
    expect(chip).toHaveAttribute('title', 'Verification state: warning');
  });

  it('renders a plural "N findings" chip when findingCount is greater than 1', () => {
    render(
      <FragmentNode
        title="Many Findings"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        verification={{ state: 'invalid', findingCount: 3 }}
      />,
    );
    const chip = screen.getByTestId('fragment-node-finding-count');
    expect(chip).toHaveTextContent('3 findings');
    expect(chip).toHaveAttribute('title', 'Verification state: invalid');
  });

  it('renders no finding-count chip at 0 findings, even with a non-valid state', () => {
    render(
      <FragmentNode
        title="Zero Findings"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        verification={{ state: 'verified', findingCount: 0 }}
      />,
    );
    expect(screen.queryByTestId('fragment-node-finding-count')).not.toBeInTheDocument();
  });

  it('keeps the state border and finding-count chip in collapsed mode', () => {
    render(
      <FragmentNode
        title="Collapsed Invalid"
        delimiter="caps-label"
        depth={1}
        text="This body should not render."
        variables={[]}
        toolMentions={[]}
        collapsed
        verification={{ state: 'invalid', findingCount: 2 }}
      />,
    );
    const card = screen.getByRole('article', { name: 'Collapsed Invalid — verification: invalid' });
    expect(card.className).toMatch(/\bborder-destructive\b/);
    expect(screen.getByTestId('fragment-node-finding-count')).toHaveTextContent('2 findings');
    expect(screen.queryByText('This body should not render.')).not.toBeInTheDocument();
  });

  it('composes the selection ring on top of a state border (ring and border are distinct utilities)', () => {
    render(
      <FragmentNode
        title="Selected Warning"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        selected
        verification={{ state: 'warning', findingCount: 2 }}
      />,
    );
    const card = screen.getByRole('article', { name: 'Selected Warning — verification: warning' });
    expect(card).toHaveAttribute('aria-current', 'true');
    expect(card.className).toMatch(/\bring-2 ring-ring\b/);
    expect(card.className).toMatch(/\bborder-amber-500\b/);
  });

  it.each([
    ['opening', 'Opening anchor', /border-l-violet-500/],
    ['closing', 'Closing anchor', /border-r-sky-500/],
    ['both', 'Opening + closing', /border-l-violet-500.*border-r-sky-500/],
  ] as const)('renders the %s prompt-position anchor with text and colour', (promptAnchor, label, classes) => {
    render(
      <FragmentNode
        title="Positioned Section"
        delimiter="caps-label"
        depth={1}
        text="body"
        variables={[]}
        toolMentions={[]}
        promptAnchor={promptAnchor}
      />,
    );

    const card = screen.getByRole('article', { name: 'Positioned Section' });
    expect(card).toHaveAttribute('data-prompt-anchor', promptAnchor);
    expect(card.className).toMatch(classes);
    expect(screen.getByText(label)).toHaveAttribute('title', expect.stringContaining('positional attention'));
  });
});
