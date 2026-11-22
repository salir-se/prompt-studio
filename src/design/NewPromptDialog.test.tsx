// @module-tag dom
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NewPromptDialog } from './NewPromptDialog';

describe('NewPromptDialog', () => {
  it('#2487: blocks duplicate creation and preserves fields with a focused async save error', async () => {
    let fail!: (cause: Error) => void;
    const pending = new Promise<void>((_resolve, reject) => {
      fail = reject;
    });
    const create = vi.fn(() => pending);
    const cancel = vi.fn();
    const view = render(<NewPromptDialog open existingIds={[]} onCreate={create} onCancel={cancel} />);
    fireEvent.change(screen.getByLabelText('Prompt ID'), { target: { value: 'find-correct-email' } });
    fireEvent.change(screen.getByLabelText('Prompt title'), { target: { value: 'Find correct email' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create prompt' }));
    expect(screen.getByRole('button', { name: 'Creating…' })).toBeDisabled();
    expect(screen.getByLabelText('Prompt ID')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Creating…' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(create).toHaveBeenCalledOnce();
    expect(cancel).not.toHaveBeenCalled();
    await act(async () => {
      fail(new Error('Network unavailable. Your edits are retained.'));
    });
    expect(screen.getByRole('alert')).toHaveTextContent('Network unavailable');
    expect(screen.getByRole('alert')).toHaveFocus();
    expect(screen.getByLabelText('Prompt ID')).toHaveValue('find-correct-email');
    expect(screen.getByLabelText('Prompt title')).toHaveValue('Find correct email');
    expect(screen.getByRole('button', { name: 'Create prompt' })).toBeEnabled();
    view.unmount();
  });
  it('defines dependencies inline and keeps invalid JSON available for correction', () => {
    const onCreate = vi.fn();
    const view = render(<NewPromptDialog open existingIds={[]} onCreate={onCreate} onCancel={vi.fn()} />);
    const fill = (name: string, value: string) =>
      fireEvent.change(screen.getByRole('textbox', { name }), { target: { value } });
    fill('Prompt ID', 'summary');
    fill('Prompt title', 'Summary');
    fireEvent.click(screen.getByText('Inputs and tools'));
    fill('Variable', 'source_document');
    fill('Variable purpose', 'Document to summarize');
    fill('Example value', 'Revenue increased 12%.');
    fill('Tool', 'fetch_document');
    fill('Tool description', 'Retrieve a source document');
    fill('Input JSON Schema', '{broken');
    fireEvent.click(screen.getByRole('button', { name: 'Create prompt' }));
    expect(onCreate).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('JSON');
    expect(screen.getByRole('textbox', { name: 'Input JSON Schema' })).toHaveValue('{broken');
    fill('Input JSON Schema', '{"type":"object"}');
    fireEvent.click(screen.getByRole('button', { name: 'Create prompt' }));
    expect(onCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        variableDefinition: expect.objectContaining({
          name: 'source_document',
          purpose: 'Document to summarize',
          sample: 'Revenue increased 12%.',
        }),
        toolDefinition: {
          name: 'fetch_document',
          description: 'Retrieve a source document',
          inputSchema: { type: 'object' },
        },
      }),
    );
    view.unmount();
  });

  it('reuses existing project definitions without editing their details', () => {
    const onCreate = vi.fn();
    const variable = {
      name: 'document',
      purpose: 'Existing purpose',
      sample: '',
      required: true,
      lifecycle: 'runtime' as const,
      encoding: 'xml-text' as const,
      presentation: 'placeholder' as const,
    };
    const view = render(
      <NewPromptDialog
        open
        existingIds={[]}
        definitions={{ variables: [variable], tools: [] }}
        onCreate={onCreate}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.change(screen.getByLabelText('Prompt ID'), { target: { value: 'summary' } });
    fireEvent.change(screen.getByLabelText('Prompt title'), { target: { value: 'Summary' } });
    fireEvent.click(screen.getByText('Inputs and tools'));
    fireEvent.change(screen.getByLabelText('Variable'), { target: { value: 'document' } });
    expect(screen.queryByRole('textbox', { name: 'Variable purpose' })).not.toBeInTheDocument();
    expect(screen.getByText(/Using the existing project variable/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Create prompt' }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ variableDefinition: variable }));
    view.unmount();
  });
  it('moves keyboard focus into the prompt dialog when it opens', () => {
    const view = render(<NewPromptDialog open existingIds={[]} onCreate={vi.fn()} onCancel={vi.fn()} />);
    expect(screen.getByRole('textbox', { name: 'Prompt title' })).toHaveFocus();
    view.unmount();
  });

  it('suggests an ID from the title while keeping an explicitly edited ID stable', () => {
    const onCreate = vi.fn();
    const view = render(
      <NewPromptDialog open existingIds={['document-summary']} onCreate={onCreate} onCancel={vi.fn()} />,
    );
    fireEvent.change(screen.getByLabelText('Prompt title'), { target: { value: 'Document summary!' } });
    expect(screen.getByLabelText('Prompt ID')).toHaveValue('document-summary');
    expect(screen.getByRole('button', { name: 'Create prompt' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Prompt ID'), { target: { value: 'my-summary' } });
    fireEvent.change(screen.getByLabelText('Prompt title'), { target: { value: 'A different summary' } });
    expect(screen.getByLabelText('Prompt ID')).toHaveValue('my-summary');
    fireEvent.click(screen.getByRole('button', { name: 'Create prompt' }));
    expect(onCreate).toHaveBeenCalledWith(expect.objectContaining({ id: 'my-summary', title: 'A different summary' }));
    view.unmount();
  });

  it('keeps an empty or unsafe suggested identity blocked until a safe ID is entered', () => {
    const view = render(<NewPromptDialog open existingIds={[]} onCreate={vi.fn()} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Prompt title'), { target: { value: '✨' } });
    expect(screen.getByLabelText('Prompt ID')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Create prompt' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('Prompt ID'), { target: { value: '../unsafe' } });
    expect(screen.getByRole('button', { name: 'Create prompt' })).toBeDisabled();
    view.unmount();
  });

  it('rejects duplicate IDs and creates a safe prompt identity', () => {
    const onCreate = vi.fn();
    const view = render(<NewPromptDialog open existingIds={['scout']} onCreate={onCreate} onCancel={vi.fn()} />);
    fireEvent.change(screen.getByLabelText('Prompt ID'), { target: { value: 'scout' } });
    fireEvent.change(screen.getByLabelText('Prompt title'), { target: { value: 'Scout copy' } });
    expect(screen.getByText('That prompt ID already exists.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Create prompt' })).toBeDisabled();

    fireEvent.change(screen.getByLabelText('Prompt ID'), { target: { value: 'account-research' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create prompt' }));
    expect(onCreate).toHaveBeenCalledWith({
      id: 'account-research',
      title: 'Scout copy',
      requestField: 'systemPrompt',
      tool: '',
      variable: '',
    });
    view.unmount();
  });
});
