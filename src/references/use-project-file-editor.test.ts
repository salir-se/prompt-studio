// @module-tag dom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CatalogRoot } from '../catalog/root-catalog';
import type { DocumentEditor } from '../hooks/use-document-editor';
import type { HistoryBoot } from '../hooks/use-history-boot';
import type { WorkspaceProjectController } from '../hooks/use-workspace-project';
import { SimpleHistoryProvider } from '../vcs/simple-history-provider';
import { MemorySnapshotStore } from '../vcs/snapshot-store';
import { useProjectFileEditor } from './use-project-file-editor';

const file = { path: 'docs/rules.md', text: 'Saved instructions', hash: 'original' };

function setup(draft = vi.fn(async (): Promise<void> => {})) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => new Response(JSON.stringify(file))),
  );
  const workspace = {
    project: { projectId: 'project', revision: 1, documents: [{ id: 'rules', ...file }] },
    draft,
  } as unknown as WorkspaceProjectController;
  const boot = { history: null, refreshAuthoredRoots: vi.fn(async () => []) } as unknown as HistoryBoot;
  const editor = { selectedRootId: 'rules', loadDocument: vi.fn() } as unknown as DocumentEditor;
  const onClose = vi.fn();
  return {
    ...renderHook(() => useProjectFileEditor(workspace, boot, editor, onClose)),
    onClose,
    draft,
    boot,
    editor,
  };
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  sessionStorage.clear();
});

it('finishes durable prompt history synchronization after the file editor is abandoned', async () => {
  const provider = new SimpleHistoryProvider({ snapshotStore: new MemorySnapshotStore() });
  await provider.init(new Map([['rules', file.text]]));
  const project = await provider.createProject('History');
  let resolveSave = () => {};
  const save = new Promise<void>((resolve) => {
    resolveSave = resolve;
  });
  const { result, boot, editor } = setup(vi.fn(() => save));
  boot.history = { provider, activeProjectId: project.id, projects: [project] };
  vi.mocked(boot.refreshAuthoredRoots).mockResolvedValue([{ id: 'rules' } as CatalogRoot]);
  await act(() => result.current.open(file.path));
  act(() => result.current.change('Durable instructions'));
  let pending: Promise<void>;
  act(() => {
    pending = result.current.save();
  });
  act(() => result.current.discard());
  await act(async () => {
    resolveSave();
    await pending;
  });
  expect((await provider.heads(project.id)).get('rules')).toBe('Durable instructions');
  expect(boot.refreshAuthoredRoots).toHaveBeenCalledWith(project.id);
  expect(editor.loadDocument).not.toHaveBeenCalled();
  expect(result.current.active).toBe(false);
});

it('allows closing a saved file when browser recovery storage is unavailable', async () => {
  const { result, onClose } = setup();
  await act(() => result.current.open(file.path));
  vi.stubGlobal('sessionStorage', {
    removeItem() {
      throw new DOMException('Storage unavailable', 'SecurityError');
    },
  });
  act(() => result.current.close());
  expect(onClose).toHaveBeenCalledOnce();
  expect(result.current.active).toBe(false);
});

it.each(['saved', 'failed'])('does not reopen an abandoned file after an in-flight save %s', async (outcome) => {
  let resolveSave = () => {};
  const save = new Promise<void>((resolve, reject) => {
    resolveSave = outcome === 'saved' ? resolve : () => reject(new Error('Save unavailable'));
  });
  const { result, draft } = setup(vi.fn(() => save));
  await act(() => result.current.open(file.path));
  act(() => result.current.change('New instructions'));
  let pending: Promise<void>;
  act(() => {
    pending = result.current.save();
  });
  expect(draft).toHaveBeenCalledWith({
    files: [{ path: file.path, text: 'New instructions', expectedHash: file.hash }],
  });
  act(() => result.current.discard());
  await act(async () => {
    resolveSave();
    await pending;
  });
  expect(result.current.active).toBe(false);
  expect(result.current.file).toBeUndefined();
  expect(result.current.saving).toBe(false);
  if (outcome === 'saved') {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(JSON.stringify({ ...file, text: 'New instructions', hash: 'saved' }))),
    );
    await act(() => result.current.open(file.path));
    expect(result.current.draft).toBe('New instructions');
    expect(result.current.file?.hash).toBe('saved');
    expect(result.current.dirty).toBe(false);
  }
});
