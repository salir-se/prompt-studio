// @module-tag dom
import { fireEvent, screen, within } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { appTests } from './App.test-harness';
import { emptyProjectDefinitions } from './prompt-repo/project-definitions';
import type { WorkspaceProject } from './prompt-repo/prompt-repo-client';
import { createWorkspacePrompt, readWorkspacePrompt, workspaceFileForDesign } from './prompt-repo/workspace-document';
import { RUN_SETTINGS } from './run/run-fixtures';

appTests((harness) => {
  const {
    renderApp,
    flushUntil,
    queryByTestId,
    byTestId,
    click,
    setTextareaValue,
    setInputValue,
    settleHistoryWrites,
    findArticleByLabel,
    findButtonByAccessibleName,
  } = harness;
  it.each(['checks', 'source'] as const)(
    'retains cancelled %s edits and discards them when graph retargeting is accepted',
    async (kind) => {
      const authored = createWorkspacePrompt({
        id: 'scope-test',
        title: 'Scope test',
        configuration: '',
        tool: '',
        variable: '',
      });
      const text = '<mission>\nPreserve source evidence.\n</mission>\n\n<output>\nCite every source.\n</output>\n';
      let saved: WorkspaceProject = {
        ok: true,
        open: true,
        projectId: 'scope-project',
        revision: 0,
        branch: 'main',
        name: 'Scope project',
        documents: [
          { id: authored.design.id, title: 'Scope test', ...workspaceFileForDesign(authored.design, text, '') },
        ],
        definitions: emptyProjectDefinitions('Scope project'),
      };
      document.head.insertAdjacentHTML('beforeend', '<meta name="studio-workspace" content="true">');
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const path = new URL(String(input), 'http://localhost').pathname;
          if (path.endsWith('/run/settings')) return Response.json(RUN_SETTINGS);
          if (path.endsWith('/draft')) {
            const patch = JSON.parse(String(init?.body)) as { documents?: { path: string; text: string }[] };
            saved = {
              ...saved,
              revision: saved.revision + 1,
              documents: saved.documents.map((document) => ({
                ...document,
                ...patch.documents?.find((file) => file.path === document.path),
              })),
            };
          }
          return { ok: true, status: 200, json: async () => saved } as unknown as Response;
        }),
      );
      renderApp();
      await flushUntil(() => queryByTestId('prompt-root-scope-test') !== null);
      click(byTestId('prompt-root-scope-test'));
      await settleHistoryWrites();
      click(findButtonByAccessibleName(document.body, 'Graph'));
      const mission = findArticleByLabel('Mission');
      const output = findArticleByLabel('Output');
      click(within(mission).getByRole('button', { name: /^Automatic checks for Mission:/ }));
      const panel = () => within(byTestId('verification-drawer'));
      if (kind === 'checks') {
        click(panel().getByRole('button', { name: 'Add AI criterion' }));
        setTextareaValue(
          panel().getByRole('textbox', { name: 'AI criterion 1' }) as HTMLTextAreaElement,
          'DISCARD THIS CRITERION',
        );
      } else {
        setTextareaValue(
          panel().getByRole('textbox', { name: 'Verification prompt source' }) as HTMLTextAreaElement,
          `${text}DISCARD THIS SOURCE EDIT`,
        );
      }
      const confirm = vi.fn().mockReturnValue(false);
      vi.stubGlobal('confirm', confirm);
      // Model setup must overlay Verify and keep both its target and unsaved drafts.
      fireEvent.mouseDown(panel().getByRole('tab', { name: 'AI review' }), { button: 0 });
      click(panel().getByRole('tab', { name: 'AI review' }));
      click(panel().getByRole('button', { name: 'Connection settings' }));
      expect(confirm).not.toHaveBeenCalled();
      const settings = within(await screen.findByRole('dialog', { name: 'App settings' }));
      expect(settings.getByRole('tab', { name: 'Models & skills' })).toHaveAttribute('aria-selected', 'true');
      fireEvent.keyDown(await settings.findByRole('textbox', { name: 'Model' }), { key: 'Escape' });
      await flushUntil(() => screen.queryByRole('dialog', { name: 'App settings' }) === null);
      expect(panel().getByRole('tab', { name: 'AI review' })).toHaveAttribute('aria-selected', 'true');
      expect(panel().getByRole('combobox', { name: 'Verification section' })).toHaveValue('scope-test.mission');
      fireEvent.mouseDown(panel().getByRole('tab', { name: 'Checks & criteria' }), { button: 0 });
      click(panel().getByRole('tab', { name: 'Checks & criteria' }));
      const retarget = () => click(within(output).getByRole('button', { name: /^Automatic checks for Output:/ }));
      retarget();
      expect(confirm).toHaveBeenCalledOnce();
      if (kind === 'checks')
        expect(panel().getByRole('textbox', { name: 'AI criterion 1' })).toHaveValue('DISCARD THIS CRITERION');
      else
        expect(panel().getByRole('textbox', { name: 'Verification prompt source' })).toHaveValue(
          `${text}DISCARD THIS SOURCE EDIT`,
        );
      confirm.mockReturnValue(true);
      retarget();
      expect(confirm).toHaveBeenCalledTimes(2);
      expect(panel().getByRole('combobox', { name: 'Verification section' })).toHaveValue('scope-test.output');
      expect(panel().queryByRole('textbox', { name: 'AI criterion 1' })).not.toBeInTheDocument();
      expect(panel().getByRole('textbox', { name: 'Verification prompt source' })).toHaveValue(text);
      click(panel().getByRole('button', { name: 'Add automatic check' }));
      setInputValue(panel().getByRole('textbox', { name: 'Required text' }) as HTMLInputElement, 'Cite every source.');
      click(panel().getByRole('button', { name: 'Add check' }));
      await flushUntil(() => saved.revision > 0);
      const stored = readWorkspacePrompt(saved.documents[0].text)!;
      expect(stored.text).toBe(text);
      expect(
        stored.design.verificationProfiles.find(
          (profile) => profile.scope === 'section' && profile.sectionId === 'scope-test.output',
        )?.deterministicRules,
      ).toContainEqual(expect.objectContaining({ kind: 'required-output-literal', literal: 'Cite every source.' }));
      expect(JSON.stringify(stored.design)).not.toContain('DISCARD THIS CRITERION');
    },
  );
});
