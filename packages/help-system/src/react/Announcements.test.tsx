// @module-tag dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Announcements } from './Announcements';

describe('Announcements', () => {
  it('renders nothing when there are no announcements', () => {
    const { container } = render(<Announcements announcements={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders each announcement and fires onDismiss', async () => {
    const onDismiss = vi.fn();
    render(
      <Announcements
        announcements={[{ id: 'v2', title: 'New: bulk actions', body: 'Select many rows at once.' }]}
        onDismiss={onDismiss}
      />,
    );
    expect(screen.getByText('New: bulk actions')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss New: bulk actions' }));
    expect(onDismiss).toHaveBeenCalledWith('v2');
  });
});
