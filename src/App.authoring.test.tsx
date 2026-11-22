// @module-tag dom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';
import { appTests } from './App.test-harness';
import { emptyProjectDefinitions } from './prompt-repo/project-definitions';
import type { WorkspaceProject } from './prompt-repo/prompt-repo-client';
import { createWorkspacePrompt, readWorkspacePrompt } from './prompt-repo/workspace-document';

appTests((harness) => {
  const {
    byTestId,
    queryByTestId,
    findArticleByLabel,
    findButtonByAccessibleName,
    click,
    setTextareaValue,
    setInputValue,
    findInputByAccessibleName,
    renderApp,
    flushUntil,
    settleHistoryWrites,
  } = harness;

  it('creates a blank authored prompt and opens its versioned design contract', async () => {
    // Creating a prompt asks the local bridge whether a prompt repository is open (#2165). None is open here, so
    // the prompt lives in the browser history only.
    const bridge = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/__studio/prompt-repo') {
        return { ok: true, status: 200, json: async () => ({ open: false }) } as unknown as Response;
      }
      return { ok: false, status: 404, json: async () => ({ ok: false }) } as unknown as Response;
    });
    vi.stubGlobal('fetch', bridge);
    await renderApp();
    const create = findButtonByAccessibleName(document.body, 'New prompt');
    await flushUntil(() => !create.disabled);
    click(create);
    setInputValue(findInputByAccessibleName(document.body, 'Prompt ID'), 'account-research');
    setInputValue(findInputByAccessibleName(document.body, 'Prompt title'), 'Account Research');
    click(findButtonByAccessibleName(document.body, 'Create prompt'));

    await flushUntil(() => document.body.textContent?.includes('Account Research') ?? false);
    const design = findButtonByAccessibleName(document.body, 'Design');
    expect(design.disabled).toBe(false);
    click(design);
    expect(document.querySelector('aside[aria-label="Prompt design"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Structurally ready.');

    click(findButtonByAccessibleName(document.body, 'Close'));
    const missionCard = findArticleByLabel('Mission');
    click(missionCard);
    const inspector = byTestId('prompt-studio-inspector');
    click(findButtonByAccessibleName(inspector, 'Design sub-prompt'));
    expect(document.querySelector('aside[aria-label="Prompt design"]')).not.toBeNull();
    expect(document.body.textContent).toContain('Sub-prompt design');
    expect(document.body.textContent).toContain('account-research.mission');
    expect(bridge.mock.calls.map(([input]) => new URL(String(input), 'http://localhost').pathname)).toContain(
      '/__studio/prompt-repo',
    );
    vi.unstubAllGlobals();
  });

  it('saves a real standalone section edit to the authoritative project and reloads its exact design', async () => {
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
        variables: [{ ...authored.design.variables[0], name: 'region' }],
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
    const mission = findArticleByLabel('Mission');
    expect(mission.textContent).toContain('primary responsibility');
    click(findButtonByAccessibleName(mission, 'Edit section'));
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    setTextareaValue(textarea, 'Research {{region}} using web_search.');
    click(findButtonByAccessibleName(document.body, 'Apply'));
    await flushUntil(() => saved.revision === 1);
    const recovered = readWorkspacePrompt(saved.documents[0].text);
    expect(recovered?.text).toContain('Research {{region}} using web_search.');
    expect(recovered?.configuration).toBe('Outreach');
    expect(recovered?.design).toEqual(authored.design);
    click(findButtonByAccessibleName(document.body, 'Variables'));
    click(findButtonByAccessibleName(document.body, 'Delete region'));
    expect(document.body.textContent).toContain(
      'Deleting this variable leaves references in Account Research unresolved.',
    );
    expect(saved.definitions.variables.some((variable) => variable.name === 'region')).toBe(true);
    click(findButtonByAccessibleName(document.body, 'Close'));
    act(() => {
      harness.root.unmount();
      harness.root = createRoot(harness.container);
    });
    renderApp();
    await flushUntil(() => queryByTestId('prompt-root-account-research') !== null);
    click(byTestId('prompt-root-account-research'));
    await settleHistoryWrites();
    expect(findArticleByLabel('Mission').textContent).toContain('Research {{region}} using web_search.');
  });

  it('retains a failed design save when text changes before recovery', async () => {
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
        variables: [{ ...authored.design.variables[0], name: 'region' }],
      },
    };
    document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
    let failDraft = true;
    const bridge = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input), 'http://localhost').pathname;
      if (path.endsWith('/draft')) {
        if (failDraft) {
          failDraft = false;
          throw new Error('Network unavailable');
        }
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
    setTextareaValue(
      document.querySelector('textarea[aria-label="Input description"]') as HTMLTextAreaElement,
      'RECOVERED DESIGN',
    );
    click(findButtonByAccessibleName(document.body, 'Save prompt design'));
    await settleHistoryWrites();
    await flushUntil(() => document.body.textContent?.includes('Network unavailable') ?? false);
    click(findButtonByAccessibleName(document.body, 'Close'));
    const mission = findArticleByLabel('Mission');
    expect(mission.textContent).toContain('primary responsibility');
    click(findButtonByAccessibleName(mission, 'Edit section'));
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    setTextareaValue(textarea, 'Research {{region}} using web_search.');
    click(findButtonByAccessibleName(document.body, 'Apply'));
    await settleHistoryWrites();
    click(findButtonByAccessibleName(document.body, 'Retry saving'));
    await flushUntil(() => saved.revision === 2);
    const recovered = readWorkspacePrompt(saved.documents[0].text);
    expect(recovered?.text).toContain('Research {{region}} using web_search.');
    expect(recovered?.configuration).toBe('Outreach');
    expect(recovered?.design.input.description).toBe('RECOVERED DESIGN');
  });

  it('keeps canonical Markdown unchanged when preview resolves project samples', async () => {
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
    const mission = findArticleByLabel('Mission');
    expect(mission.textContent).toContain('primary responsibility');
    click(findButtonByAccessibleName(mission, 'Edit section'));
    const textarea = document.querySelector('textarea') as HTMLTextAreaElement;
    setTextareaValue(textarea, 'Research {{region}} using web_search.');
    click(findButtonByAccessibleName(document.body, 'Apply'));
    await flushUntil(() => saved.revision === 1);
    click(findButtonByAccessibleName(document.body, 'Final prompt'));
    click(byTestId('final-prompt-source-toggle'));
    expect(byTestId('final-prompt-raw').textContent).toContain('Research {{region}} using web_search.');
  });
});
