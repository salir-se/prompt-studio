// @module-tag dom
/**
 * BDD tests for LabelChip.
 *
 * Behaviour contracts:
 *  - Renders the label text.
 *  - Exposes its kind via `data-kind` so root/variable/tool are each distinctly targetable/stylable.
 *  - Applies distinct tint classes per kind (root = neutral, variable = violet, tool = sky) — matching
 *    `FragmentNode`'s chip colour vocabulary.
 *  - Exposes selection via `data-selected` and a visible ring, off by default.
 *  - Truncates a long label rather than growing the fixed footprint.
 */

import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LabelChip } from './LabelChip';

describe('LabelChip', () => {
  it('renders the label text', () => {
    render(<LabelChip kind="root" label="scout" />);
    expect(screen.getByText('scout')).toBeInTheDocument();
  });

  it.each([
    ['root', 'root'],
    ['variable', 'variable'],
    ['tool', 'tool'],
  ] as const)('exposes data-kind="%s" for the %s kind', (kind, expectedKind) => {
    render(<LabelChip kind={kind} label="example" />);
    expect(screen.getByTestId('label-chip')).toHaveAttribute('data-kind', expectedKind);
  });

  it('applies a distinct violet tint for the variable kind', () => {
    render(<LabelChip kind="variable" label="company_name" />);
    expect(screen.getByTestId('label-chip').className).toMatch(/violet/);
  });

  it('applies a distinct sky tint for the tool kind', () => {
    render(<LabelChip kind="tool" label="web_search" />);
    expect(screen.getByTestId('label-chip').className).toMatch(/sky/);
  });

  it('applies a neutral (non-tinted) style for the root kind', () => {
    render(<LabelChip kind="root" label="scout" />);
    const chip = screen.getByTestId('label-chip');
    expect(chip.className).not.toMatch(/violet/);
    expect(chip.className).not.toMatch(/sky/);
  });

  it('is not marked selected by default', () => {
    render(<LabelChip kind="tool" label="web_search" />);
    const chip = screen.getByTestId('label-chip');
    expect(chip).toHaveAttribute('data-selected', 'false');
    expect(chip.className).not.toMatch(/ring-2/);
  });

  it('marks the chip selected via data-selected and a ring when selected is true', () => {
    render(<LabelChip kind="variable" label="icp" selected />);
    const chip = screen.getByTestId('label-chip');
    expect(chip).toHaveAttribute('data-selected', 'true');
    expect(chip.className).toMatch(/ring-2/);
  });

  // ── onPath (ancestor-path highlight) ─────────────────────────────────────

  it('is not marked on-path by default (onPath defaults to false)', () => {
    render(<LabelChip kind="root" label="scout" />);
    const chip = screen.getByTestId('label-chip');
    expect(chip).toHaveAttribute('data-on-path', 'false');
    expect(chip.className).not.toMatch(/ring-1/);
  });

  it('renders the subtler ring-1 ring-ring/50 treatment when onPath is true', () => {
    render(<LabelChip kind="root" label="scout" onPath />);
    const chip = screen.getByTestId('label-chip');
    expect(chip).toHaveAttribute('data-on-path', 'true');
    expect(chip.className).toMatch(/ring-1 ring-ring\/50/);
    expect(chip.className).not.toMatch(/ring-2/);
  });

  it('lets selected win over onPath when both are true (no on-path ring on the selected chip itself)', () => {
    render(<LabelChip kind="root" label="scout" selected onPath />);
    const chip = screen.getByTestId('label-chip');
    expect(chip).toHaveAttribute('data-selected', 'true');
    expect(chip).toHaveAttribute('data-on-path', 'false');
    expect(chip.className).toMatch(/ring-2 ring-ring\b/);
    expect(chip.className).not.toMatch(/ring-1/);
  });

  it('applies a truncate class so a long label clips instead of growing the fixed footprint', () => {
    const longLabel =
      'this_is_an_extremely_long_unbroken_variable_name_with_no_whitespace_anywhere_for_the_browser_to_wrap_on';
    render(<LabelChip kind="variable" label={longLabel} />);
    expect(screen.getByText(longLabel).className).toMatch(/\btruncate\b/);
  });
});
