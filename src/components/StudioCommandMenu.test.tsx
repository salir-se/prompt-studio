// @module-tag dom
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { expect, it, vi } from 'vitest';
import { AdoptPromptDialog } from '../adoption/AdoptPromptDialog';
import { emptyProjectDefinitions } from '../prompt-repo/project-definitions';
import { StudioCommandMenu } from './StudioCommandMenu';

it('opens a document dialog from File and returns focus to File when cancelled', async () => {
  function Workspace() {
    const [open, setOpen] = useState(false);
    return (
      <>
        <StudioCommandMenu label="File" commands={[{ label: 'Add existing', run: () => setOpen(true) }]} />
        {open && (
          <AdoptPromptDialog
            definitions={emptyProjectDefinitions('Test')}
            existingIds={[]}
            onAdopt={async () => {}}
            onClose={() => setOpen(false)}
          />
        )}
      </>
    );
  }
  render(<Workspace />);
  const file = screen.getByRole('button', { name: 'File' });
  file.focus();
  fireEvent.pointerDown(file, { button: 0, ctrlKey: false });
  fireEvent.click(await screen.findByRole('menuitem', { name: 'Add existing' }));
  await waitFor(() => expect(screen.getByRole('textbox', { name: 'Existing prompt' })).toHaveFocus());
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  await waitFor(() => expect(file).toHaveFocus());
});

it('dismisses File without running an unselected command', async () => {
  const run = vi.fn();
  render(<StudioCommandMenu label="File" commands={[{ label: 'Add existing', run }]} />);
  const file = screen.getByRole('button', { name: 'File' });
  file.focus();
  fireEvent.pointerDown(file, { button: 0, ctrlKey: false });
  fireEvent.keyDown(await screen.findByRole('menuitem', { name: 'Add existing' }), { key: 'Escape' });
  await waitFor(() => expect(screen.queryByRole('menu')).not.toBeInTheDocument());
  expect(run).not.toHaveBeenCalled();
  await waitFor(() => expect(file).toHaveFocus());
});
