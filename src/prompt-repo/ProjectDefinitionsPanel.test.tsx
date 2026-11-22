// @module-tag dom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ProjectDefinitionsPanel } from './ProjectDefinitionsPanel';
import { exportDefinitions } from './definition-transfer';
import type { ProjectDefinitions, ProjectVariable } from './project-definitions';

const variable: ProjectVariable = {
  name: 'company',
  purpose: 'Company name',
  sample: 'Example',
  required: true,
  lifecycle: 'runtime',
  encoding: 'xml-text',
  presentation: 'placeholder',
};
const project: ProjectDefinitions = {
  format: 'prompt-studio-project@1',
  name: 'Sales',
  variables: [variable],
  tools: [],
};
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function upload(text: string, kind = 'variables') {
  const file = new File([text], `${kind}.json`, { type: 'application/json' });
  fireEvent.change(screen.getByLabelText(`Upload ${kind} JSON`), { target: { files: [file] } });
}

function Harness({
  initial = project,
  kind = 'variables',
  save = async () => {},
}: {
  initial?: ProjectDefinitions;
  kind?: 'variables' | 'tools';
  save?: (value: ProjectDefinitions) => Promise<void>;
}) {
  const [definitions, setDefinitions] = useState(initial);
  return (
    <ProjectDefinitionsPanel
      kind={kind}
      definitions={definitions}
      onClose={vi.fn()}
      onSave={async (next) => {
        await save(next);
        setDefinitions(next);
      }}
    />
  );
}

describe('ProjectDefinitionsPanel', () => {
  it('imports after preview and explicit conflict choice, saves, and exports an equivalent collection', async () => {
    const saved = vi.fn(async (_value: ProjectDefinitions) => {});
    const source = {
      ...project,
      variables: [
        { ...variable, purpose: 'Imported purpose' },
        { ...variable, name: 'region', purpose: 'Region' },
      ],
    };
    render(<Harness save={saved} />);
    upload(exportDefinitions(source, 'variables'));
    await screen.findByRole('region', { name: 'Import preview' });
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Import into project' })).toBeDisabled();
    fireEvent.change(screen.getByLabelText('When a name already exists'), { target: { value: 'replace' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import into project' }));
    await screen.findByText('Saved to this project.');
    expect(saved).toHaveBeenCalledWith(source);
    expect(exportDefinitions(saved.mock.calls[0][0], 'variables')).toBe(exportDefinitions(source, 'variables'));
    expect(screen.getByRole('heading', { name: 'region' })).toBeInTheDocument();
  });

  it('keeps existing definitions when requested and still adds new names', async () => {
    const saved = vi.fn(async (_value: ProjectDefinitions) => {});
    render(<Harness save={saved} />);
    upload(
      exportDefinitions(
        {
          ...project,
          variables: [
            { ...variable, purpose: 'Replacement' },
            { ...variable, name: 'region' },
          ],
        },
        'variables',
      ),
    );
    await screen.findByRole('region', { name: 'Import preview' });
    fireEvent.change(screen.getByLabelText('When a name already exists'), { target: { value: 'keep' } });
    fireEvent.click(screen.getByRole('button', { name: 'Import into project' }));
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(saved.mock.calls[0][0].variables).toEqual([variable, { ...variable, name: 'region' }]);
  });

  it.each([
    '{invalid',
    JSON.stringify({ format: 'prompt-studio-variables@1', variables: [variable, variable] }),
    JSON.stringify({
      format: 'prompt-studio-variables@1',
      variables: [{ ...variable, lifecycle: 'server-only', sample: 'secret' }],
    }),
  ])('invalid uploads leave the project unchanged', async (text) => {
    const saved = vi.fn();
    render(<Harness save={saved} />);
    upload(text);
    await screen.findByRole('alert');
    if (text === '{invalid')
      expect(screen.getByRole('alert')).toHaveTextContent(
        'This file is not valid JSON. Choose a variables JSON export and try again.',
      );
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByRole('heading', { name: 'company' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Import preview' })).not.toBeInTheDocument();
  });

  it('creates a variable with safe defaults and retains edits when saving fails', async () => {
    const saved = vi.fn().mockRejectedValueOnce(new Error('Disk is full. Try again.')).mockResolvedValueOnce(undefined);
    render(<Harness save={saved} />);
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'region' } });
    fireEvent.change(screen.getByLabelText('Purpose'), { target: { value: 'Target region' } });
    fireEvent.change(screen.getByLabelText('Example value'), { target: { value: 'Stockholm' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save variable' }));
    await screen.findByRole('alert');
    expect(screen.getByLabelText('Example value')).toHaveValue('Stockholm');
    fireEvent.click(screen.getByRole('button', { name: 'Save variable' }));
    await screen.findByText('Saved to this project.');
    expect(saved.mock.calls[1][0].variables[1]).toEqual({
      ...variable,
      name: 'region',
      purpose: 'Target region',
      sample: 'Stockholm',
    });
  });

  it('imports and edits tools with their input schemas', async () => {
    const saved = vi.fn(async (_value: ProjectDefinitions) => {});
    const tool = {
      name: 'lookup',
      description: 'Find a company',
      inputSchema: { type: 'object', properties: { name: { type: 'string' } } },
    };
    render(<Harness kind="tools" save={saved} />);
    upload(JSON.stringify({ format: 'prompt-studio-tools@1', tools: [tool] }), 'tools');
    await screen.findByRole('region', { name: 'Import preview' });
    fireEvent.click(screen.getByRole('button', { name: 'Import into project' }));
    await screen.findByText('Saved to this project.');
    expect(saved.mock.calls[0][0].tools).toEqual([tool]);
    fireEvent.click(screen.getByRole('button', { name: 'Edit lookup' }));
    fireEvent.change(screen.getByRole('textbox', { name: /Input JSON Schema/ }), {
      target: { value: '{"type":"object","required":["name"]}' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Save tool' }));
    await waitFor(() => expect(saved).toHaveBeenCalledTimes(2));
    expect(saved.mock.calls[1][0].tools[0].inputSchema).toEqual({ type: 'object', required: ['name'] });
  });

  it('requires confirmation to delete a referenced definition', async () => {
    const saved = vi.fn(async () => {});
    render(
      <ProjectDefinitionsPanel
        kind="variables"
        definitions={project}
        references={{ company: ['Research prompt'] }}
        onClose={vi.fn()}
        onSave={saved}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete company' }));
    expect(saved).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Research prompt');
    fireEvent.click(screen.getByRole('button', { name: 'Delete anyway' }));
    await act(async () => {});
    expect(saved).toHaveBeenCalledWith({ ...project, variables: [] });
  });
  it('asks before replacing an unsaved definition with Add, Edit, or import', async () => {
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'region' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    fireEvent.click(screen.getByRole('button', { name: 'Edit company' }));
    upload(exportDefinitions(project, 'variables'));
    await waitFor(() => expect(confirm).toHaveBeenCalledTimes(3));
    expect(screen.getByLabelText('Name')).toHaveValue('region');
    confirm.mockReturnValue(true);
    fireEvent.click(screen.getByRole('button', { name: 'Edit company' }));
    expect(screen.getByLabelText('Name')).toHaveValue('company');
  });
  it('locks definition editing while an uploaded file is being read', async () => {
    let finish!: (text: string) => void;
    const file = new File([], 'variables.json', { type: 'application/json' });
    vi.spyOn(file, 'text').mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Add variable' }));
    fireEvent.change(screen.getByLabelText('Upload variables JSON'), { target: { files: [file] } });
    expect(screen.getByLabelText('Name')).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Add variable' })).toBeDisabled();
    await act(async () => finish(exportDefinitions(project, 'variables')));
    await screen.findByRole('region', { name: 'Import preview' });
    expect(screen.getByRole('button', { name: 'Add variable' })).toBeEnabled();
  });
});
