// @module-tag dom
import { expect, it, vi } from 'vitest';
import { appTests } from './App.test-harness';
import { emptyProjectDefinitions } from './prompt-repo/project-definitions';
import type { WorkspaceProject } from './prompt-repo/prompt-repo-client';
import { createWorkspacePrompt } from './prompt-repo/workspace-document';

appTests((harness) => {
  const {
    byTestId,
    queryByTestId,
    findButtonByAccessibleName,
    click,
    setTextareaValue,
    renderApp,
    pressEscape,
    flushUntil,
    settleHistoryWrites,
  } = harness;

  it('keeps an unsaved design when drawer navigation is cancelled', async () => {
    const authored = createWorkspacePrompt({
      id: 'account-research',
      title: 'Account Research',
      configuration: 'Outreach',
      tool: 'web_search',
      variable: 'company',
    });
    let saved: WorkspaceProject = {
      ok: true,
      open: true,
      projectId: 'isolated',
      revision: 0,
      branch: 'main',
      name: 'Research project',
      documents: [{ id: 'account-research', title: 'Account Research', ...authored.document }],
      definitions: {
        ...emptyProjectDefinitions('Research project'),
        variables: [{ ...authored.design.variables[0], name: 'region', sample: 'Europe' }],
      },
    };
    document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
    const bridge = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path.endsWith('/draft')) {
        const patch = JSON.parse(String(init?.body)) as {
          projectId: string;
          revision: number;
          documents: { path: string; text: string }[];
        };
        expect(patch.projectId).toBe(saved.projectId);
        expect(patch.revision).toBe(saved.revision);
        saved = {
          ...saved,
          revision: saved.revision + 1,
          documents: saved.documents.map((document) => ({
            ...document,
            ...patch.documents.find((item) => item.path === document.path),
          })),
        };
      }
      return { ok: true, status: 200, json: async () => saved } as unknown as Response;
    });
    vi.stubGlobal('fetch', bridge);
    renderApp();
    await flushUntil(() => queryByTestId('prompt-root-account-research') !== null);
    click(byTestId('prompt-root-account-research'));
    await settleHistoryWrites();
    click(findButtonByAccessibleName(document.body, 'Design'));
    const input = document.querySelector('[aria-label="Input description"]') as HTMLTextAreaElement;
    setTextareaValue(input, 'UNSAVED INTENDED CONTRACT');
    const confirm = vi.fn().mockReturnValue(false);
    vi.stubGlobal('confirm', confirm);
    click(findButtonByAccessibleName(document.body, 'Design'));
    expect(confirm).not.toHaveBeenCalled();
    click(findButtonByAccessibleName(document.body, 'Variables'));
    click(findButtonByAccessibleName(document.body, 'Close'));
    pressEscape();
    click(byTestId('prompt-root-account-research'));
    click(findButtonByAccessibleName(document.body, 'Your prompts'));
    expect(confirm).toHaveBeenCalledTimes(5);
    expect((document.querySelector('[aria-label="Input description"]') as HTMLTextAreaElement).value).toBe(
      'UNSAVED INTENDED CONTRACT',
    );
    confirm.mockReturnValue(true);
    click(findButtonByAccessibleName(document.body, 'Variables'));
    expect(confirm).toHaveBeenCalledTimes(6);
    click(findButtonByAccessibleName(document.body, 'Edit region'));
    const purpose = document.querySelector('aside textarea') as HTMLTextAreaElement;
    setTextareaValue(purpose, 'UNSAVED VARIABLE PURPOSE');
    confirm.mockReturnValue(false);
    click(findButtonByAccessibleName(document.body, 'Design'));
    expect(confirm).toHaveBeenCalledTimes(7);
    expect((document.querySelector('aside textarea') as HTMLTextAreaElement).value).toBe('UNSAVED VARIABLE PURPOSE');
    confirm.mockReturnValue(true);
    click(findButtonByAccessibleName(document.body, 'Design'));
    expect(confirm).toHaveBeenCalledTimes(8);
    expect((document.querySelector('[aria-label="Input description"]') as HTMLTextAreaElement).value).toBe(
      'Free-text user request.',
    );
  });
});
