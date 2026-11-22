// @module-tag dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { HelpLauncher } from './HelpLauncher';

describe('HelpLauncher', () => {
  it('renders a button with the default accessible name "Help"', () => {
    render(<HelpLauncher isOpen={false} onClick={() => {}} />);
    const button = screen.getByRole('button', { name: 'Help' });
    expect(button).toBeInTheDocument();
    expect(button).toHaveAttribute('type', 'button');
    expect(button).toHaveAttribute('data-help-launcher');
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
  });

  it('calls onClick when the button is clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<HelpLauncher isOpen={false} onClick={onClick} />);
    await user.click(screen.getByRole('button', { name: 'Help' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('reflects the closed state via aria-expanded and shows the "?" glyph', () => {
    render(<HelpLauncher isOpen={false} onClick={() => {}} />);
    const button = screen.getByRole('button', { name: 'Help' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    expect(button).toHaveTextContent('?');
  });

  it('reflects the open state via aria-expanded and shows the "×" glyph', () => {
    render(<HelpLauncher isOpen onClick={() => {}} />);
    const button = screen.getByRole('button', { name: 'Help' });
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(button).toHaveTextContent('×');
  });

  it('uses a custom label as the accessible name', () => {
    render(<HelpLauncher isOpen={false} onClick={() => {}} label="Open help" />);
    expect(screen.getByRole('button', { name: 'Open help' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Help' })).not.toBeInTheDocument();
  });
});
