// @module-tag dom
import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { ThinkingIndicator } from './ThinkingIndicator';

describe('ThinkingIndicator', () => {
  it('renders an accessible "thinking" placeholder turn', () => {
    render(
      <ul>
        <ThinkingIndicator />
      </ul>,
    );
    const item = screen.getByRole('listitem', { name: /assistant is thinking/i });
    expect(item).toHaveAttribute('data-help-thinking');
    // The visible "Thinking" label is present for sighted users.
    expect(item).toHaveTextContent(/thinking/i);
  });

  it('hides the decorative dots from assistive tech', () => {
    const { container } = render(
      <ul>
        <ThinkingIndicator />
      </ul>,
    );
    expect(container.querySelector('[aria-hidden="true"]')).toBeInTheDocument();
  });
});
