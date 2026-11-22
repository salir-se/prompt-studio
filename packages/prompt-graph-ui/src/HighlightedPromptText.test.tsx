// @module-tag dom
/**
 * BDD tests for HighlightedPromptText.
 *
 * Behaviour contracts:
 *  - Renders the value (via the underlying byte-transparent textarea).
 *  - Typing calls onChange with the new text.
 *  - Backdrop renders a tinted span per token kind: variable / unknown-variable / tool / tag.
 *  - The backdrop layer is aria-hidden (decorative-only, never reachable by AT).
 */

import type { PromptToken } from '@prompt-studio/prompts';
import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { HighlightedPromptText } from './HighlightedPromptText';

const VALUE = 'Hello {{product_name}} and {{mystery}} — use web_search inside <special_skill>.';
const TOKENS: PromptToken[] = [
  { kind: 'text', text: 'Hello ' },
  { kind: 'variable', text: '{{product_name}}', name: 'product_name' },
  { kind: 'text', text: ' and ' },
  { kind: 'unknown-variable', text: '{{mystery}}', name: 'mystery' },
  { kind: 'text', text: ' — use ' },
  { kind: 'tool', text: 'web_search', name: 'web_search' },
  { kind: 'text', text: ' inside ' },
  { kind: 'tag', text: '<special_skill>', name: 'special_skill' },
  { kind: 'text', text: '.' },
];

describe('HighlightedPromptText', () => {
  it('renders the value', () => {
    render(<HighlightedPromptText value={VALUE} onChange={() => {}} tokens={TOKENS} ariaLabel="Section body" />);
    const textarea = screen.getByRole('textbox', { name: 'Section body' }) as HTMLTextAreaElement;
    expect(textarea.value).toBe(VALUE);
  });

  it('calls onChange with the new text when the user types', () => {
    const onChange = vi.fn();
    render(<HighlightedPromptText value="" onChange={onChange} tokens={[]} ariaLabel="Section body" />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Section body' }), { target: { value: 'edited draft' } });
    expect(onChange).toHaveBeenCalledWith('edited draft');
  });

  it('renders a tinted span for a variable token', () => {
    render(<HighlightedPromptText value={VALUE} onChange={() => {}} tokens={TOKENS} />);
    const span = screen.getByText('{{product_name}}');
    expect(span.tagName).toBe('SPAN');
    expect(span).toHaveClass('bg-violet-100/70', 'text-violet-800');
  });

  it('renders a tinted span for an unknown-variable token', () => {
    render(<HighlightedPromptText value={VALUE} onChange={() => {}} tokens={TOKENS} />);
    const span = screen.getByText('{{mystery}}');
    expect(span.tagName).toBe('SPAN');
    expect(span).toHaveClass('bg-amber-100/80', 'text-amber-900');
  });

  it('renders a tinted span for a tool token', () => {
    render(<HighlightedPromptText value={VALUE} onChange={() => {}} tokens={TOKENS} />);
    const span = screen.getByText('web_search');
    expect(span.tagName).toBe('SPAN');
    expect(span).toHaveClass('bg-sky-100/70', 'text-sky-800');
  });

  it('renders a tinted span for a tag token', () => {
    render(<HighlightedPromptText value={VALUE} onChange={() => {}} tokens={TOKENS} />);
    const span = screen.getByText('<special_skill>');
    expect(span.tagName).toBe('SPAN');
    expect(span).toHaveClass('bg-emerald-100/70', 'text-emerald-800');
  });

  it('reserves the same scrollbar space in the textarea and the backdrop, so a long fragment wraps identically', () => {
    // Given: a fragment in the overlay editor (a long one scrolls and, on Windows or Linux, shows a scrollbar).
    render(<HighlightedPromptText value={VALUE} onChange={() => {}} tokens={TOKENS} ariaLabel="Section body" />);
    // When: the two layers are read.
    const textarea = screen.getByRole('textbox', { name: 'Section body' });
    const backdrop = screen.getByTestId('highlighted-prompt-text-backdrop');
    // Then: both keep a stable scrollbar gutter, so the scrollbar never narrows only the textarea's text.
    expect(textarea).toHaveClass('[scrollbar-gutter:stable]');
    expect(backdrop).toHaveClass('[scrollbar-gutter:stable]');
  });

  it('marks the backdrop layer aria-hidden', () => {
    render(<HighlightedPromptText value={VALUE} onChange={() => {}} tokens={TOKENS} />);
    expect(screen.getByTestId('highlighted-prompt-text-backdrop')).toHaveAttribute('aria-hidden', 'true');
  });
});

it('numbers logical lines including blank and trailing lines without replacing the textarea', () => {
  const value = '<mission\n  role="writer">\n\nInstructions\n';
  const tokens: PromptToken[] = [
    { kind: 'tag', text: '<mission\n  role="writer">', name: 'mission' },
    { kind: 'text', text: '\n\nInstructions\n' },
  ];
  const onChange = vi.fn();
  const view = render(<HighlightedPromptText value={value} tokens={tokens} onChange={onChange} lineNumbers />);
  const input = screen.getByRole('textbox') as HTMLTextAreaElement;
  input.focus();
  input.setSelectionRange(4, 9);
  const lines = screen.getAllByTestId('prompt-line-number');
  expect(lines.map((line) => line.textContent)).toEqual(['1', '2', '3', '4', '5']);
  expect(screen.getByTestId('highlighted-prompt-text-backdrop')).toHaveAttribute('aria-hidden', 'true');
  const highlighted = document.querySelectorAll('[data-token-kind="tag"]');
  expect(
    Array.from(highlighted)
      .map((part) => part.textContent)
      .join('\n'),
  ).toBe('<mission\n  role="writer">');
  view.rerender(<HighlightedPromptText value={value} tokens={tokens} onChange={onChange} lineNumbers={false} />);
  expect(screen.getByRole('textbox')).toBe(input);
  expect(input.selectionStart).toBe(4);
  expect(input.selectionEnd).toBe(9);
  expect(input).toHaveValue(value);
  expect(screen.queryByTestId('prompt-line-number')).not.toBeInTheDocument();
  expect(onChange).not.toHaveBeenCalled();
});
