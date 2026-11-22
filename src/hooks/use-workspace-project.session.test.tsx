// @module-tag dom
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { emptyProjectDefinitions } from '../prompt-repo/project-definitions';
import { useWorkspaceProject } from './use-workspace-project';

afterEach(() => {
  document.querySelector('meta[name="studio-workspace"]')?.remove();
  document.querySelector('meta[name="studio-token"]')?.remove();
  localStorage.clear();
  vi.unstubAllGlobals();
});

it.each(['refresh', 'retry'])(
  '#2518: a failed %s keeps the draft exportable and shows the next action',
  async (failure) => {
    // Given: a real project controller/client with a page from the previous server boot.
    document.head.insertAdjacentHTML(
      'beforeend',
      '<meta name="studio-workspace" content="true"><meta name="studio-token" content="old-token">',
    );
    const initial = {
      ok: true,
      open: true,
      projectId: 'retained',
      revision: 7,
      name: 'Retained',
      branch: 'main',
      documents: [],
      definitions: emptyProjectDefinitions('Retained'),
    };
    const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status });
    const request = vi
      .fn()
      .mockResolvedValueOnce(reply(200, initial))
      .mockResolvedValueOnce(reply(401, { error: 'Unauthorized.' }));
    if (failure === 'refresh') request.mockResolvedValueOnce(reply(403, { error: 'Forbidden.' }));
    else
      request
        .mockResolvedValueOnce(reply(200, { ok: true, token: 'new-token' }))
        .mockResolvedValueOnce(reply(401, { error: 'Unauthorized.' }));
    vi.stubGlobal('fetch', request);
    const hook = renderHook(() => useWorkspaceProject());
    await waitFor(() => expect(hook.result.current.loading).toBe(false));
    const patch = { documents: [{ path: 'prompts/task.md', text: '# Task\nDo not lose these instructions.' }] };
    // When: session recovery fails during a save through the unchanged project controller.
    await act(async () => {
      await expect(hook.result.current.draft(patch)).rejects.toThrow('Retry saving');
    });
    // Then: both memory and browser recovery retain the source, project and revision.
    expect(hook.result.current.project).toEqual(initial);
    expect(hook.result.current.error).toMatch(/Retry saving.*export recovered changes/);
    expect(hook.result.current.exportRecovery()).toMatchObject({ revision: 7, patches: [patch] });
    expect(Object.values(localStorage).join('')).toContain('Do not lose these instructions.');
    expect(request).toHaveBeenCalledTimes(failure === 'refresh' ? 3 : 4);
    hook.unmount();
  },
);
