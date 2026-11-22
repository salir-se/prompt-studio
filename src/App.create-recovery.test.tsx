// @module-tag dom
import { expect, it, vi } from 'vitest';
import { appTests } from './App.test-harness';
import { emptyProjectDefinitions } from './prompt-repo/project-definitions';
import type { WorkspaceProject } from './prompt-repo/prompt-repo-client';
import { createWorkspacePrompt, readWorkspacePrompt } from './prompt-repo/workspace-document';

appTests((h) => {
  it.each(['success', 'network failure', 'concurrent revision'] as const)(
    '#2487: creates after an earlier failed save without losing work (%s)',
    async (recovery) => {
      const initial = createWorkspacePrompt({
        id: 'existing',
        title: 'Existing',
        configuration: 'Default',
        tool: '',
        variable: '',
      });
      let saved: WorkspaceProject = {
        ok: true,
        open: true,
        projectId: 'creation-recovery',
        revision: 0,
        branch: 'main',
        name: 'Creation recovery',
        documents: [{ id: 'existing', title: 'Existing', ...initial.document }],
        definitions: emptyProjectDefinitions('Creation recovery'),
      };
      let failed = false;
      document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(String(input), 'http://localhost').pathname;
          if (path.endsWith('/draft')) {
            if (!failed || recovery === 'network failure') {
              failed = true;
              throw new Error('Network unavailable. Your previous edits are retained.');
            }
            const patch = JSON.parse(String(init?.body));
            expect(patch.revision).toBe(saved.revision);
            const documents = new Map(saved.documents.map((document) => [document.path, document]));
            for (const document of patch.documents ?? []) {
              const parsed = readWorkspacePrompt(document.text);
              documents.set(document.path, {
                ...documents.get(document.path),
                id: parsed?.design.id ?? 'existing',
                title: parsed?.design.title ?? 'Existing',
                ...document,
              });
            }
            saved = {
              ...saved,
              documents: [...documents.values()],
              definitions: patch.definitions ?? saved.definitions,
              revision: saved.revision + 1,
            };
          }
          return { ok: true, status: 200, json: async () => saved } as Response;
        }),
      );
      h.renderApp();
      await h.flushUntil(() => h.queryByTestId('prompt-root-existing') !== null);
      h.click(h.byTestId('prompt-root-existing'));
      h.click(h.findButtonByAccessibleName(document.body, 'Graph'));
      const mission = h.findArticleByLabel('Mission');
      h.click(h.findButtonByAccessibleName(mission, 'Edit section'));
      h.setTextareaValue(document.querySelector('textarea')!, 'Keep this previous edit.');
      h.click(h.findButtonByAccessibleName(document.body, 'Apply'));
      await h.flushUntil(() => document.body.textContent?.includes('Network unavailable') ?? false);
      h.click(h.findButtonByAccessibleName(document.body, 'New prompt'));
      h.setInputValue(h.findInputByAccessibleName(document.body, 'Prompt ID'), 'find-correct-email');
      h.setInputValue(h.findInputByAccessibleName(document.body, 'Prompt title'), 'Find correct email');
      if (recovery === 'concurrent revision') saved = { ...saved, revision: saved.revision + 1 };
      h.click(h.findButtonByAccessibleName(document.body, 'Create prompt'));
      if (recovery !== 'success') {
        await h.flushUntil(() => document.querySelector('[role="dialog"] [role="alert"]') !== null);
        expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toContain(
          recovery === 'network failure' ? 'Network unavailable' : 'The saved project changed since these edits',
        );
        expect(h.findInputByAccessibleName(document.body, 'Prompt ID').value).toBe('find-correct-email');
        expect(h.commitSpy.mock.calls.filter(([input]) => input.rootKey === 'find-correct-email')).toHaveLength(0);
        expect(saved.documents).toHaveLength(1);
        expect(Object.values(localStorage).join('')).toContain('Keep this previous edit.');
        return;
      }
      await h.flushUntil(
        () =>
          saved.documents.length === 2 ||
          (document.body.textContent?.includes('Previous changes are unsaved') ?? false),
      );
      expect(document.body.textContent).not.toContain('Previous changes are unsaved');
      await h.flushUntil(() => h.queryByTestId('prompt-root-find-correct-email') !== null);
      expect(document.querySelector('[role="dialog"]')).toBeNull();
      expect(readWorkspacePrompt(saved.documents.find((document) => document.id === 'existing')!.text)?.text).toContain(
        'Keep this previous edit.',
      );
      expect(
        readWorkspacePrompt(saved.documents.find((document) => document.id === 'find-correct-email')!.text)?.design
          .title,
      ).toBe('Find correct email');
      expect(document.querySelector('[data-testid="edit-error-banner"]')).toBeNull();
    },
  );
});
