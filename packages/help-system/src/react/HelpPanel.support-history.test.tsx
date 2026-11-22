// @module-tag dom
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, it, vi } from 'vitest';
import { HelpPanel } from './HelpPanel';

it('reopens host reports from Help history even with AI disabled without sending them to AI', async () => {
  // Given: a locally retained host report and a disabled AI surface.
  const onOpen = vi.fn();
  const onSend = vi.fn();
  render(
    <HelpPanel
      pageKey="Dashboard"
      pageLabel="Dashboard"
      faq={[]}
      onClose={vi.fn()}
      aiEnabled={false}
      onSend={onSend}
      supportDraft={{
        active: false,
        actions: null,
        content: null,
        onCommand: () => false,
        history: {
          label: 'Support reports',
          entries: [{ id: 'report-1', title: 'Report a bug · Dashboard', updatedAt: Date.now() }],
          onOpen,
        },
      }}
    />,
  );
  // When: the user returns to that report through the existing history browser.
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Past conversations' }));
  await user.click(screen.getByRole('button', { name: /Report a bug · Dashboard/ }));
  // Then: the report's host opens it and its contents never enter an assistant turn.
  expect(onOpen).toHaveBeenCalledExactlyOnceWith('report-1');
  expect(onSend).not.toHaveBeenCalled();
});
