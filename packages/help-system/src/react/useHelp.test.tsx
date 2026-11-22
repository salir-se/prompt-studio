// @module-tag dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { HelpContent } from '../core/types';
import { HelpProvider } from './HelpProvider';
import { useHelp } from './useHelp';

const content: HelpContent = {
  pages: { Scout: { pageLabel: 'Scout', faq: [] } },
};

function OpenHelpButton() {
  const { open, isOpen, pageKey } = useHelp();
  return (
    <button type="button" onClick={open}>
      open help for {pageKey} ({isOpen ? 'open' : 'closed'})
    </button>
  );
}

describe('useHelp', () => {
  it('throws a helpful error when used outside a HelpProvider', () => {
    // Rendering the consumer alone must throw — the message guides the developer.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<OpenHelpButton />)).toThrow(/useHelp must be used within a <HelpProvider>/);
    spy.mockRestore();
  });

  it('exposes the live page context and opens the panel programmatically', async () => {
    const user = userEvent.setup();
    render(
      <HelpProvider content={content} pageKey="Scout">
        <OpenHelpButton />
      </HelpProvider>,
    );
    // The consumer reads the current page from context.
    const trigger = screen.getByRole('button', { name: /open help for scout \(closed\)/i });
    await user.click(trigger);
    expect(screen.getByRole('dialog', { name: /help — scout/i })).toBeInTheDocument();
  });
});
