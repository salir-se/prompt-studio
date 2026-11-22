// @module-tag dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { emptyProjectDefinitions } from '../prompt-repo/project-definitions';
import { projectCommand, studioJson, type WorkspaceProject } from '../prompt-repo/prompt-repo-client';
import { useWorkspaceProject } from './use-workspace-project';

vi.mock('../prompt-repo/prompt-repo-client', () => ({ studioJson: vi.fn(), projectCommand: vi.fn() }));
const initial: WorkspaceProject = {
  ok: true,
  open: true,
  projectId: 'one',
  revision: 0,
  name: 'One',
  branch: 'main',
  documents: [],
  definitions: emptyProjectDefinitions('One'),
};
afterEach(() => {
  document.querySelector('meta[name="studio-workspace"]')?.remove();
  localStorage.clear();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});
describe('durable workspace drafts', () => {
  it('fences project export with the editor identity and revision', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
    vi.mocked(studioJson).mockResolvedValue(initial);
    const hook = renderHook(() => useWorkspaceProject());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await act(async () => {
      await hook.result.current.exportProject();
    });
    expect(studioJson).toHaveBeenLastCalledWith('/__studio/prompt-repo/export?projectId=one&revision=0');
  });
  it('keeps another editor recovery after this editor saves and both reload', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
    vi.mocked(studioJson).mockResolvedValue(initial);
    const first = renderHook(() => useWorkspaceProject());
    const second = renderHook(() => useWorkspaceProject());
    await waitFor(() => expect(first.result.current.loading || second.result.current.loading).toBe(false));
    vi.mocked(projectCommand).mockRejectedValueOnce(new Error('offline'));
    await act(async () => {
      await first.result.current
        .draft({ documents: [{ path: 'prompts/a.md', text: 'A unsaved work' }] })
        .catch(() => undefined);
    });
    vi.mocked(projectCommand).mockResolvedValueOnce({ ...initial, revision: 1 });
    await act(async () => {
      await second.result.current.draft({ documents: [{ path: 'prompts/b.md', text: 'B saved edit' }] });
    });
    expect(Object.values(localStorage).join('')).toContain('A unsaved work');
    first.unmount();
    second.unmount();
    const reload = renderHook(() => useWorkspaceProject());
    await waitFor(() => expect(reload.result.current.loading).toBe(false));
    expect(JSON.stringify(reload.result.current.recoveryBackups)).toContain('A unsaved work');
    await act(async () => {
      await reload.result.current.recoverBackup(reload.result.current.recoveryBackups[0].key);
    });
    expect(JSON.stringify(reload.result.current.exportRecovery())).toContain('A unsaved work');
  });

  it('never clears a live editor backup when another editor copies and acknowledges it', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
    vi.mocked(studioJson).mockResolvedValue(initial);
    vi.mocked(projectCommand).mockRejectedValue(new Error('offline'));
    const first = renderHook(() => useWorkspaceProject());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    await act(async () => {
      await first.result.current
        .draft({ documents: [{ path: 'prompts/a.md', text: 'live editor work' }] })
        .catch(() => undefined);
    });
    const second = renderHook(() => useWorkspaceProject());
    await waitFor(() => expect(second.result.current.recoveryBackups).toHaveLength(1));
    const sourceKey = second.result.current.recoveryBackups[0].key;
    await act(async () => {
      await second.result.current.recoverBackup(sourceKey);
    });
    vi.mocked(projectCommand).mockResolvedValue({ ...initial, revision: 1 });
    await act(async () => {
      await second.result.current.retry();
    });
    expect(localStorage.getItem(sourceKey)).toContain('live editor work');
    expect(first.result.current.exportRecovery().patches).toHaveLength(1);
    expect(second.result.current.exportRecovery().patches).toHaveLength(0);
    expect(Object.keys(localStorage)).toEqual([sourceKey]);
  });
  it('removes only the explicitly selected foreign backup, preserving this editor recovery', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
    const key = 'prompt-studio-unsaved:one:other-editor';
    localStorage.setItem(
      key,
      JSON.stringify({ revision: 0, patches: [{ documents: [{ path: 'prompts/a.md', text: 'foreign' }] }] }),
    );
    vi.mocked(studioJson).mockResolvedValue(initial);
    vi.mocked(projectCommand).mockRejectedValue(new Error('offline'));
    const hook = renderHook(() => useWorkspaceProject());
    await waitFor(() => expect(hook.result.current.recoveryBackups).toHaveLength(1));
    await act(async () => {
      await hook.result.current
        .draft({ documents: [{ path: 'prompts/a.md', text: 'own retained draft' }] })
        .catch(() => undefined);
      await hook.result.current.removeRecoveryBackup(key);
    });
    expect(localStorage.getItem(key)).toBeNull();
    expect(Object.values(localStorage).join('')).toContain('own retained draft');
    expect(hook.result.current.exportRecovery().patches).toHaveLength(1);
    expect(hook.result.current.recoveryBackups).toEqual([]);
  });
  it('preserves legacy recovery and rereads another editor backup before copying', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
    const key = 'prompt-studio-unsaved:one';
    const recovery = { revision: 0, patches: [{ documents: [{ path: 'prompts/a.md', text: 'legacy' }] }] };
    localStorage.setItem(key, JSON.stringify(recovery));
    vi.mocked(studioJson).mockResolvedValue(initial);
    const hook = renderHook(() => useWorkspaceProject());
    await waitFor(() => expect(hook.result.current.recoveryBackups).toHaveLength(1));
    localStorage.setItem(
      key,
      JSON.stringify({ ...recovery, patches: [{ documents: [{ path: 'prompts/a.md', text: 'latest' }] }] }),
    );
    await act(async () => {
      await hook.result.current.recoverBackup(key);
    });
    expect(JSON.stringify(hook.result.current.exportRecovery())).toContain('latest');
    await act(async () => {
      await hook.result.current.keepSavedVersion();
    });
    expect(localStorage.getItem(key)).toContain('latest');
  });
  it('retains every failed edit when the first retry fails again', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="test">');
    vi.mocked(studioJson).mockResolvedValue(initial);
    vi.mocked(projectCommand).mockRejectedValue(new Error('offline'));
    const { result } = renderHook(() => useWorkspaceProject());
    await waitFor(() => expect(result.current.project).toEqual(initial));
    const first = { documents: [{ path: 'prompts/a.md', text: 'first' }] };
    const second = { documents: [{ path: 'prompts/b.md', text: 'second' }] };
    await act(async () => {
      await result.current.draft(first).catch(() => undefined);
      await result.current.draft(second).catch(() => undefined);
    });
    await act(async () => {
      await result.current.retry().catch(() => undefined);
    });
    vi.mocked(projectCommand).mockClear();
    vi.mocked(projectCommand).mockResolvedValue(initial);
    await act(async () => {
      await result.current.retry();
    });
    expect(
      vi.mocked(projectCommand).mock.calls.map((call) => {
        const { mutationId: _id, ...body } = call[1] as Record<string, unknown>;
        return body;
      }),
    ).toEqual([
      { projectId: 'one', revision: 0, ...first },
      { projectId: 'one', revision: 0, ...second },
    ]);
  });
  it('recovers failed drafts after a reload and prevents overwriting a changed server revision', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
    vi.mocked(studioJson).mockResolvedValue(initial);
    vi.mocked(projectCommand).mockRejectedValue(new Error('offline'));
    const first = renderHook(() => useWorkspaceProject());
    await waitFor(() => expect(first.result.current.loading).toBe(false));
    const patch = { documents: [{ path: 'prompts/a.md', text: 'keep me' }] };
    await act(async () => {
      await first.result.current.draft(patch).catch(() => undefined);
    });
    first.unmount();
    vi.mocked(studioJson).mockResolvedValue({ ...initial, revision: 5 });
    const second = renderHook(() => useWorkspaceProject());
    await waitFor(() => expect(second.result.current.recoveryBackups).toHaveLength(1));
    await act(async () => {
      await second.result.current.recoverBackup(second.result.current.recoveryBackups[0].key);
    });
    expect(second.result.current.exportRecovery().patches).toMatchObject([patch]);
    vi.mocked(projectCommand).mockClear();
    await act(async () => {
      await expect(second.result.current.retry()).rejects.toThrow('project changed');
    });
    expect(projectCommand).not.toHaveBeenCalled();
    expect(second.result.current.exportRecovery().patches).toMatchObject([patch]);
    await act(async () => {
      await second.result.current.keepSavedVersion();
    });
    expect(second.result.current.project?.revision).toBe(5);
    expect(second.result.current.exportRecovery().patches).toEqual([]);
    await expect(second.result.current.flush()).resolves.toBeUndefined();
  });
  it('does not intercept developer mode merely because a bridge token exists', () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="studio-token" content="test">');
    const hook = renderHook(() => useWorkspaceProject());
    expect(hook.result.current.enabled).toBe(false);
    expect(studioJson).not.toHaveBeenCalled();
    document.querySelector('meta[name="studio-token"]')?.remove();
  });
  it('marks a browser recovery-storage failure unsaved and retains downloadable edits', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
    vi.mocked(studioJson).mockResolvedValue(initial);
    const hook = renderHook(() => useWorkspaceProject());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new Error('quota');
    });
    const patch = { documents: [{ path: 'prompts/a.md', text: 'keep me' }] };
    await act(async () => {
      await hook.result.current.draft(patch).catch(() => undefined);
    });
    expect(hook.result.current.error).toContain('recovery storage');
    expect(hook.result.current.exportRecovery().patches).toMatchObject([patch]);
    expect(projectCommand).not.toHaveBeenCalled();
  });
  it.each([
    { later: false, reload: false },
    { later: true, reload: false },
    { later: true, reload: true },
  ])(
    'acknowledges a lost response before retrying later edits (later=$later, reload=$reload)',
    async ({ later, reload }) => {
      document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
      let server: WorkspaceProject = initial;
      vi.mocked(studioJson).mockImplementation(async () => server);
      vi.mocked(projectCommand).mockImplementationOnce(async (_command, input) => {
        server = {
          ...initial,
          revision: 1,
          lastDraft: { mutationId: (input as { mutationId: string }).mutationId, revision: 1 },
          documents: [{ id: 'a', title: 'A', path: 'prompts/a.md', text: 'first' }],
        };
        throw new Error('Connection lost after saving');
      });
      let hook = renderHook(() => useWorkspaceProject());
      await waitFor(() => expect(hook.result.current.loading).toBe(false));
      await act(async () => {
        await hook.result.current
          .draft({ documents: [{ path: 'prompts/a.md', text: 'first' }] })
          .catch(() => undefined);
        if (later)
          await hook.result.current
            .draft({ documents: [{ path: 'prompts/a.md', text: 'second' }] })
            .catch(() => undefined);
      });
      if (reload) {
        hook.unmount();
        hook = renderHook(() => useWorkspaceProject());
        await waitFor(() => expect(hook.result.current.loading).toBe(false));
        await act(async () => {
          await hook.result.current.recoverBackup(hook.result.current.recoveryBackups[0].key);
        });
      }
      vi.mocked(projectCommand).mockClear();
      vi.mocked(projectCommand).mockImplementation(async (_command, value) => {
        expect(value).toMatchObject({ revision: 1, documents: [{ path: 'prompts/a.md', text: 'second' }] });
        return { ...server, revision: 2, documents: [{ ...server.documents[0], text: 'second' }] };
      });
      await act(async () => {
        await hook.result.current.retry();
      });
      expect(projectCommand).toHaveBeenCalledTimes(later ? 1 : 0);
      expect(hook.result.current.project?.documents[0].text).toBe(later ? 'second' : 'first');
      expect(hook.result.current.exportRecovery().patches).toEqual([]);
      await expect(hook.result.current.flush()).resolves.toBeUndefined();
    },
  );
  it('does not acknowledge matching bytes when an additional server revision intervened', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
    vi.mocked(studioJson).mockResolvedValue(initial);
    vi.mocked(projectCommand).mockRejectedValue(new Error('lost response'));
    const hook = renderHook(() => useWorkspaceProject());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const patch = { documents: [{ path: 'prompts/a.md', text: 'first' }] };
    await act(async () => {
      await hook.result.current.draft(patch).catch(() => undefined);
    });
    vi.mocked(studioJson).mockResolvedValue({
      ...initial,
      revision: 2,
      documents: [{ id: 'a', title: 'A', path: 'prompts/a.md', text: 'first' }],
    });
    vi.mocked(projectCommand).mockClear();
    await act(async () => {
      await expect(hook.result.current.retry()).rejects.toThrow('project changed');
    });
    expect(projectCommand).not.toHaveBeenCalled();
    expect(hook.result.current.exportRecovery().patches).toMatchObject([patch]);
  });
  it('never mistakes another tab write for a lost no-op draft response', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
    const original = { ...initial, documents: [{ id: 'a', title: 'A', path: 'prompts/a.md', text: 'same text' }] };
    let server: WorkspaceProject = original;
    vi.mocked(studioJson).mockImplementation(async () => server);
    vi.mocked(projectCommand).mockImplementationOnce(async () => {
      server = {
        ...original,
        revision: 1,
        lastDraft: { mutationId: 'another-tab', revision: 1 },
        definitions: {
          ...original.definitions,
          tools: [{ name: 'new_tool', description: 'Added in another tab', inputSchema: {} }],
        },
      };
      throw new Error('Stale revision');
    });
    const hook = renderHook(() => useWorkspaceProject());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    await act(async () => {
      await hook.result.current
        .draft({ documents: [{ path: 'prompts/a.md', text: 'same text' }] })
        .catch(() => undefined);
      await hook.result.current
        .draft({ definitions: { ...original.definitions, name: 'Rename project' } })
        .catch(() => undefined);
    });
    vi.mocked(projectCommand).mockClear();
    vi.mocked(projectCommand).mockResolvedValue(server);
    await act(async () => {
      await expect(hook.result.current.retry()).rejects.toThrow('project changed');
    });
    expect(projectCommand).not.toHaveBeenCalled();
    expect(hook.result.current.exportRecovery().patches).toHaveLength(2);
    expect(server.definitions.tools[0].name).toBe('new_tool');
  });

  it('reopens only the original project for recovery while ordinary project switching remains blocked', async () => {
    document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
    let server: WorkspaceProject = initial;
    vi.mocked(studioJson).mockImplementation(async () => server);
    vi.mocked(projectCommand).mockRejectedValue(new Error('offline'));
    const hook = renderHook(() => useWorkspaceProject());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const patch = { documents: [{ path: 'prompts/a.md', text: 'recover me' }] };
    await act(async () => {
      await hook.result.current.draft(patch).catch(() => undefined);
    });
    const queued = hook.result.current.exportRecovery().patches[0];
    expect(queued.mutationId).toMatch(/^[a-f0-9-]{36}$/);
    server = { ...initial, projectId: 'other' };
    await act(async () => {
      await expect(hook.result.current.retry()).rejects.toThrow('different project');
    });
    await expect(hook.result.current.switchProject('resume', { projectId: 'other' })).rejects.toThrow('not saved');
    vi.mocked(projectCommand).mockImplementation(async (command, input) => {
      if (command === 'resume') {
        expect(input).toEqual({ projectId: 'one' });
        server = initial;
        return initial;
      }
      expect(input).toMatchObject({ projectId: 'one', revision: 0, mutationId: queued.mutationId, ...patch });
      return { ...initial, revision: 1, documents: [{ id: 'a', title: 'A', ...patch.documents[0] }] };
    });
    await act(async () => {
      await hook.result.current.reopenOriginalProject();
    });
    expect(hook.result.current.exportRecovery().patches).toEqual([queued]);
    await act(async () => {
      await hook.result.current.retry();
    });
    expect(hook.result.current.exportRecovery().patches).toEqual([]);
  });
});

it('retries a failed edit without remounting an active repair workspace when requested', async () => {
  // Given: an active editor with a queued source repair after a storage failure.
  document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
  vi.mocked(studioJson).mockResolvedValue(initial);
  const hook = renderHook(() => useWorkspaceProject());
  await waitFor(() => expect(hook.result.current.loading).toBe(false));
  vi.mocked(projectCommand).mockRejectedValueOnce(new Error('offline'));
  await act(async () => {
    await hook.result.current
      .draft({ documents: [{ path: 'prompts/repair.md', text: 'Retained repair' }] })
      .catch(() => undefined);
  });
  vi.mocked(projectCommand).mockResolvedValue({ ...initial, revision: 1 });
  // When: the repair flow retries through the existing recovery guards.
  await act(async () => {
    await hook.result.current.retry({ keepEditor: true });
  });
  // Then: the repair is durable, the recovery buffer is clear, and selection/drafts stay mounted.
  expect(hook.result.current.project?.revision).toBe(1);
  expect(hook.result.current.exportRecovery().patches).toHaveLength(0);
  expect(hook.result.current.generation).toBe(0);
});
