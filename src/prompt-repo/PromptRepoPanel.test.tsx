// @module-tag dom
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceProjectController } from '../hooks/use-workspace-project';
import { PromptRepoPanel } from './PromptRepoPanel';
import { emptyProjectDefinitions } from './project-definitions';

const documents = [
  { id: 'scout', title: 'scout', path: 'prompts/scout.md', text: 'Scout, revised' },
  { id: 'closer', title: 'closer', path: 'prompts/closer.md', text: 'Closer, revised' },
];
function workspace(): WorkspaceProjectController {
  return {
    enabled: true,
    loading: false,
    busy: false,
    pending: 0,
    error: null,
    generation: 0,
    project: {
      ok: true,
      open: true,
      projectId: 'acme',
      revision: 2,
      name: 'acme',
      branch: 'main',
      documents,
      definitions: emptyProjectDefinitions('acme'),
    },
    draft: vi.fn(async () => undefined),
    flush: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    keepSavedVersion: vi.fn(async () => undefined),
    reopenOriginalProject: vi.fn(async () => undefined),
    switchProject: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    restore: vi.fn(async () => undefined),
    exportProject: vi.fn(async () => ({ format: 'prompt-studio-project-files@1' as const, name: 'acme', files: [] })),
    publish: vi.fn(async () => ({ url: 'https://github.com/acme/prompts/pull/1' })),
    exportRecovery: () => ({ revision: 2, patches: [] }),
  };
}
afterEach(() => vi.unstubAllGlobals());
function mockRead(): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async (input) =>
        new Response(
          JSON.stringify(
            String(input).includes('/history')
              ? { ok: true, versions: [{ commit: 'abcdef12345', message: 'Before changes' }] }
              : { ok: true, configured: true, connected: false, projects: [] },
          ),
          { headers: { 'content-type': 'application/json' } },
        ),
    ),
  );
}
describe('PromptRepoPanel', () => {
  it('leads with current project identity and explains checkpoint versus prompt restore scope', async () => {
    mockRead();
    const user = userEvent.setup();
    render(<PromptRepoPanel workspace={workspace()} onClose={() => undefined} />);
    const identity = screen.getByRole('region', { name: 'Current project' });
    expect(identity).toHaveTextContent('acme');
    expect(identity).toHaveTextContent('main');
    expect(identity).toHaveTextContent('Applied edits saved on this computer.');
    await user.click(screen.getByRole('tab', { name: 'Versions' }));
    expect(screen.getByText(/A checkpoint covers the project/)).toBeInTheDocument();
    await user.click(screen.getByText('Saved versions'));
    expect(screen.getByText(/Other prompts stay as they are/)).toBeVisible();
    expect(within(identity).getByText('2 prompts')).toBeInTheDocument();
  });

  it('previews archive files and exclusions before importing a separate project', async () => {
    mockRead();
    const state = workspace();
    const user = userEvent.setup();
    render(<PromptRepoPanel workspace={state} onClose={() => undefined} />);
    const archive = {
      format: 'prompt-studio-project-files@1',
      name: 'Imported toolkit',
      files: [{ path: 'prompts/brief.md', base64: 'YnJpZWY=' }],
    };
    await user.upload(
      screen.getByLabelText('Import project archive (JSON)'),
      new File([JSON.stringify(archive)], 'project.json', { type: 'application/json' }),
    );
    await user.click(await screen.findByText('Included files'));
    expect(screen.getByText('prompts/brief.md')).toBeVisible();
    expect(screen.getByText(/Git history, credentials and local evaluation results are excluded/)).toBeInTheDocument();
    expect(state.switchProject).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Import as new project' }));
    expect(state.switchProject).toHaveBeenCalledWith('import', archive);
  });

  it('rejects malformed archive entries before displaying a preview', async () => {
    mockRead();
    const user = userEvent.setup();
    render(<PromptRepoPanel workspace={workspace()} onClose={() => undefined} />);
    const archive = {
      format: 'prompt-studio-project-files@1',
      name: 'Broken archive',
      files: [{ path: { bad: 'value' }, base64: 'YnJpZWY=' }],
    };
    await user.upload(
      screen.getByLabelText('Import project archive (JSON)'),
      new File([JSON.stringify(archive)], 'broken.json', { type: 'application/json' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an exported Prompt Studio project JSON file.');
    expect(screen.queryByRole('button', { name: 'Import as new project' })).not.toBeInTheDocument();
  });

  it('lets a user copy or export a recovery backup from an earlier session', async () => {
    mockRead();
    const state = {
      ...workspace(),
      recoveryBackups: [
        {
          key: 'backup',
          recovery: { revision: 2, patches: [{ documents: [{ path: 'prompts/a.md', text: 'retained' }] }] },
        },
      ],
      recoverBackup: vi.fn(async () => undefined),
      removeRecoveryBackup: vi.fn(async () => undefined),
    };
    const user = userEvent.setup();
    render(<PromptRepoPanel workspace={state} onClose={() => undefined} />);
    expect(screen.getByRole('region', { name: 'Saved recovery backups' })).toHaveTextContent('earlier session');
    expect(screen.getByRole('button', { name: 'Export backup 1' })).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Copy backup 1 into this editor' }));
    expect(state.recoverBackup).toHaveBeenCalledWith('backup');
    await user.click(screen.getByRole('button', { name: 'Remove backup 1' }));
    expect(state.removeRecoveryBackup).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Remove recovery backup' })).toHaveTextContent('another open editor');
    await user.click(screen.getByRole('button', { name: 'Permanently remove backup' }));
    expect(state.removeRecoveryBackup).toHaveBeenCalledWith('backup');
  });
  it('shows save errors and recovery actions before project forms', async () => {
    mockRead();
    render(<PromptRepoPanel workspace={{ ...workspace(), error: 'Edits retained.' }} onClose={() => {}} />);
    await screen.findByRole('button', { name: 'Connect GitHub' });
    const controls = Array.from(
      screen.getByRole('region', { name: 'Your prompts' }).querySelectorAll('[role="alert"],button'),
    );
    const createIndex = controls.indexOf(screen.getByRole('button', { name: 'Create project' }));
    expect(controls.indexOf(screen.getByRole('alert'))).toBeLessThan(createIndex);
    expect(controls.indexOf(screen.getByRole('button', { name: 'Retry saving' }))).toBeLessThan(createIndex);
  });
  it('opens either a filesystem path or HTTPS repository with the shared project controller', async () => {
    mockRead();
    const state = workspace();
    const user = userEvent.setup();
    render(<PromptRepoPanel workspace={state} onClose={() => undefined} />);
    const input = screen.getByRole('textbox', { name: 'Repository URL or filesystem path' });
    await user.type(input, '/Users/person/prompts');
    await user.click(screen.getByRole('button', { name: 'Open project' }));
    expect(state.switchProject).toHaveBeenCalledWith('open', { path: '/Users/person/prompts' });
    await user.clear(input);
    await user.type(input, 'https://github.com/acme/prompts');
    await user.type(screen.getByRole('textbox', { name: 'Source branch (optional)' }), 'review-prompts');
    await user.click(screen.getByRole('button', { name: 'Open project' }));
    expect(state.switchProject).toHaveBeenCalledWith('open', {
      url: 'https://github.com/acme/prompts',
      branch: 'review-prompts',
    });
    expect(screen.getByRole('region', { name: 'Your prompts' }).textContent).not.toMatch(/manifest|memfs|isomorphic/i);
  });
  it('saves both current editor documents through the authoritative save command without separate panel drafts', async () => {
    mockRead();
    const state = workspace();
    const user = userEvent.setup();
    render(<PromptRepoPanel workspace={state} onClose={() => undefined} />);
    await user.click(screen.getByRole('tab', { name: 'Versions' }));
    expect(screen.getByText(/2 prompts/)).toBeInTheDocument();
    const message = screen.getByRole('textbox', { name: 'Version message' });
    await user.clear(message);
    await user.type(message, 'Revise research and outreach');
    await user.click(screen.getByRole('tab', { name: 'Versions' }));
    await user.click(screen.getByRole('button', { name: 'Save version' }));
    expect(state.save).toHaveBeenCalledWith('Revise research and outreach');
    expect(state.project?.documents.map((document) => document.text)).toEqual(['Scout, revised', 'Closer, revised']);
    expect(state.draft).not.toHaveBeenCalled();
    expect(await screen.findByText('Saved a version of your project.')).toBeInTheDocument();
  });
  it('offers saved prompt versions after reopening and restores the selected version explicitly', async () => {
    mockRead();
    const state = workspace();
    const user = userEvent.setup();
    render(<PromptRepoPanel workspace={state} onClose={() => undefined} />);
    await user.click(screen.getByRole('tab', { name: 'Versions' }));
    await user.click(screen.getByText('Saved versions'));
    await user.selectOptions(screen.getByRole('combobox', { name: 'Prompt' }), 'prompts/scout.md');
    expect(await screen.findByText('Before changes (abcdef1)')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Restore this version' }));
    expect(state.restore).toHaveBeenCalledWith('prompts/scout.md', 'abcdef12345');
  });
  it('brings an action failure into view without losing the entered repository', async () => {
    mockRead();
    const user = userEvent.setup();
    const state = {
      ...workspace(),
      switchProject: vi.fn(async () => {
        throw new Error('Could not open that repository.');
      }),
    };
    render(<PromptRepoPanel workspace={state} onClose={() => undefined} />);
    const input = screen.getByRole('textbox', { name: 'Repository URL or filesystem path' });
    await user.type(input, '/missing/prompts');
    await user.click(screen.getByRole('button', { name: 'Open project' }));
    expect(await screen.findByRole('alert')).toHaveFocus();
    expect(input).toHaveValue('/missing/prompts');
  });

  it('requires explicit confirmation before discarding recovered edits', async () => {
    mockRead();
    const state = { ...workspace(), error: 'The saved project changed.' };
    const user = userEvent.setup();
    render(<PromptRepoPanel workspace={state} onClose={() => undefined} />);
    await user.click(screen.getByRole('button', { name: 'Keep saved version' }));
    expect(state.keepSavedVersion).not.toHaveBeenCalled();
    expect(screen.getByRole('region', { name: 'Discard recovered edits' })).toHaveTextContent(
      'Export recovered changes first',
    );
    await user.click(screen.getByRole('button', { name: 'Discard recovered edits and keep saved version' }));
    expect(state.keepSavedVersion).toHaveBeenCalledOnce();
  });
});

it('requests the selected project history and clears it when the project changes', async () => {
  mockRead();
  const state = workspace();
  const user = userEvent.setup();
  const { rerender } = render(<PromptRepoPanel workspace={state} onClose={() => undefined} />);
  await user.click(screen.getByRole('tab', { name: 'Versions' }));
  await user.click(screen.getByText('Saved versions'));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Prompt' }), 'prompts/scout.md');
  await screen.findByText(/Before changes/);
  const historyCall = vi.mocked(fetch).mock.calls.find(([url]) => String(url).includes('/history'))!;
  const query = new URL(String(historyCall[0]), 'http://localhost').searchParams;
  expect(query.get('projectId')).toBe('acme');
  expect(query.get('revision')).toBe('2');
  rerender(
    <PromptRepoPanel
      workspace={{ ...state, project: { ...state.project!, projectId: 'other' } }}
      onClose={() => undefined}
    />,
  );
  expect(screen.queryByText(/Before changes/)).not.toBeInTheDocument();
});

it('ignores a late history response after selecting a different prompt', async () => {
  mockRead();
  const read = vi.mocked(fetch).getMockImplementation()!;
  let finishFirst!: (response: Response) => void;
  vi.mocked(fetch).mockImplementation((input, init) => {
    if (String(input).includes('/history') && String(input).includes('scout'))
      return new Promise<Response>((resolve) => {
        finishFirst = resolve;
      });
    return read(input, init);
  });
  const user = userEvent.setup();
  render(<PromptRepoPanel workspace={workspace()} onClose={() => undefined} />);
  await user.click(screen.getByRole('tab', { name: 'Versions' }));
  await user.click(screen.getByText('Saved versions'));
  await user.selectOptions(screen.getByRole('combobox', { name: 'Prompt' }), 'prompts/scout.md');
  await user.selectOptions(screen.getByRole('combobox', { name: 'Prompt' }), 'prompts/closer.md');
  await screen.findByText(/Before changes/);
  await act(async () =>
    finishFirst(Response.json({ versions: [{ commit: 'stale', message: 'Wrong scout version' }] })),
  );
  expect(screen.queryByText(/Wrong scout version/)).not.toBeInTheDocument();
  expect(screen.getByText(/Before changes/)).toBeInTheDocument();
});
