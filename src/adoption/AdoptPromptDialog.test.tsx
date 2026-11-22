// @module-tag dom
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { emptyProjectDefinitions } from '../prompt-repo/project-definitions';
import { AdoptPromptDialog } from './AdoptPromptDialog';
import type { AdoptionResult } from './adopt-prompt';

describe('guided adoption', () => {
  it('adopts sections, variable, tool and workflow together with the submit shortcut', async () => {
    const onAdopt = vi.fn(async (_result: AdoptionResult) => undefined);
    render(
      <AdoptPromptDialog
        definitions={emptyProjectDefinitions('Test')}
        existingIds={[]}
        onAdopt={onAdopt}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Existing prompt' }), {
      target: {
        value: '# Summary\n## Instructions\nRead {{document}} with fetch_document.\n## Output\nReturn summary.',
      },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Purpose of document' }), {
      target: { value: 'Source document' },
    });
    fireEvent.change(screen.getByRole('combobox', { name: 'Tool name 1' }), { target: { value: 'fetch_document' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Tool description 1' }), {
      target: { value: 'Fetch a document' },
    });
    fireEvent.change(screen.getByRole('textbox', { name: 'Adoption input' }), { target: { value: 'Document' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Adoption output' }), { target: { value: 'Summary' } });
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Adoption output' }), { key: 'Enter', ctrlKey: true });
    await waitFor(() => expect(onAdopt).toHaveBeenCalledOnce());
    expect(onAdopt.mock.calls[0]?.[0]).toMatchObject({
      id: 'summary',
      design: { tools: ['fetch_document'], sectionDesigns: [expect.anything(), expect.anything()] },
    });
  });
  it('keeps source and review available together while retaining the save action', () => {
    render(
      <AdoptPromptDialog
        definitions={emptyProjectDefinitions('Test')}
        existingIds={[]}
        initial={{ text: '# Task\nDo work.', filename: 'task.md' }}
        onAdopt={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    expect(
      within(screen.getByRole('region', { name: 'Source' })).getByRole('textbox', { name: 'Existing prompt' }),
    ).toHaveValue('# Task\nDo work.');
    expect(
      within(screen.getByRole('region', { name: 'Review' })).getByRole('textbox', { name: 'Adoption input' }),
    ).toBeVisible();
    expect(screen.getByRole('button', { name: 'Save and verify' })).toBeEnabled();
  });
  it('keeps Ctrl+Enter inside the pattern preview from submitting adoption', async () => {
    const onAdopt = vi.fn();
    const user = userEvent.setup();
    render(
      <AdoptPromptDialog
        definitions={emptyProjectDefinitions('Test')}
        existingIds={[]}
        initial={{ text: '# Task\nDo work.', filename: 'task.md' }}
        onAdopt={onAdopt}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Adoption input' }), { target: { value: 'Request' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Adoption output' }), { target: { value: 'Result' } });
    const save = screen.getByRole('button', { name: 'Save and verify' });
    fireEvent.click(screen.getByText('Workflow design'));
    fireEvent.click(screen.getByRole('button', { name: 'Choose pattern' }));
    const pattern = screen.getByRole('tab', { name: 'Routing' });
    await user.click(pattern);
    await user.keyboard('{Control>}{Enter}{/Control}');
    expect(save).toBeEnabled();
    expect(onAdopt).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Choose a workflow pattern' })).not.toBeInTheDocument();
    expect((screen.getByRole('textbox', { name: 'Adoption workflow' }) as HTMLTextAreaElement).value).toContain(
      'Classify request',
    );
  });
  it('retains entered data when saving fails', async () => {
    render(
      <AdoptPromptDialog
        definitions={emptyProjectDefinitions('Test')}
        existingIds={[]}
        initial={{ text: '# Task\nDo work.', filename: 'task.md' }}
        onAdopt={async () => {
          throw new Error('Disk unavailable');
        }}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByRole('textbox', { name: 'Adoption input' }), { target: { value: 'Request' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Adoption output' }), { target: { value: 'Result' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save and verify' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Disk unavailable');
    expect(screen.getByRole('textbox', { name: 'Existing prompt' })).toHaveValue('# Task\nDo work.');
  });
});
