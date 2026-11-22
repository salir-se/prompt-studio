// @module-tag dom
import { createBlankPromptDesign, parsePromptTree, projectCanonicalPromptTree } from '@prompt-studio/prompts';
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import {
  authoredPromptRootsFromHeads,
  promptDesignProviderKey,
  withPromptStructure,
} from '../design/prompt-design-project';
import { runRootVerification } from '../panels/root-verification';
import { requestSemanticVerification, type SemanticVerificationOutcome } from '../panels/semantic-verification-client';
import type { DocumentEditor } from './use-document-editor';
import type { PanelState } from './use-panel-state';
import { useVerificationWorkspace } from './use-verification-workspace';
import type { WorkspaceProjectController } from './use-workspace-project';

vi.mock('../panels/semantic-verification-client', () => ({ requestSemanticVerification: vi.fn() }));
const request = vi.mocked(requestSemanticVerification);
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});
function fixture() {
  const created = createBlankPromptDesign({ id: 'example', title: 'Example' });
  const root = authoredPromptRootsFromHeads(
    new Map([
      [created.design.id, created.text],
      [promptDesignProviderKey(created.design.id), JSON.stringify(created.design)],
    ]),
  ).roots[0];
  const tree = projectCanonicalPromptTree(
    parsePromptTree({ key: root.id, text: created.text }),
    root.verification!.sections,
  );
  const result = runRootVerification(root, created.text)!;
  return {
    editor: {
      selectedRoot: root,
      doc: { rootId: root.id, text: created.text },
      tree,
      runVerification: vi.fn(),
    } as unknown as DocumentEditor,
    workspace: {
      project: { projectId: 'project', revision: 3, documents: [{ id: root.id, path: 'prompts/example.md' }] },
      pending: false,
      error: null,
    } as unknown as WorkspaceProjectController,
    panels: {
      activePanel: null,
      openPanel: vi.fn(() => true),
      confirmDiscard: vi.fn(() => true),
    } as unknown as PanelState,
    result,
  };
}
function changedDesign(input: ReturnType<typeof fixture>) {
  const root = input.editor.selectedRoot!;
  return {
    ...input,
    editor: {
      ...input.editor,
      selectedRoot: withPromptStructure(
        {
          ...root,
          design: {
            ...root.design!,
            version: root.design!.version + 1,
            workflow: 'flowchart LR\n Input --> ChangedOutput',
          },
        },
        input.editor.doc!.text,
      ),
    },
  };
}

it('marks completed AI evidence stale when Design changes but the previous automatic report is retained', async () => {
  const input = fixture();
  const section = input.result.sections.find((section) => section.profile.scope === 'section')!;
  request.mockResolvedValue({ kind: 'ok', findings: [], model: 'review-model' });
  const hook = renderHook((value) => useVerificationWorkspace(value), { initialProps: input });
  await act(async () => {
    await hook.result.current.semantic.run(section);
  });
  expect(hook.result.current.semantic.statusBySectionId[section.sectionId]).toBe('current');
  const changed = changedDesign(input);
  hook.rerender(changed);
  expect(hook.result.current.semantic.statusBySectionId[section.sectionId]).toBe('stale');
  expect(hook.result.current.semantic.forSection(section).status).toBe('idle');
  expect(Object.values(hook.result.current.coverage!.byNodeId)[0].automatic.status).toBe('stale');
  // Returning to identical Design definitions can reuse the captured, matching evidence.
  hook.rerender(input);
  expect(hook.result.current.semantic.statusBySectionId[section.sectionId]).toBe('current');
});

it('drops a late AI response after current Design changes without losing the last automatic coverage snapshot', async () => {
  const input = fixture();
  const section = input.result.sections.find((section) => section.profile.scope === 'section')!;
  let finish: (outcome: SemanticVerificationOutcome) => void = () => {};
  request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const hook = renderHook((value) => useVerificationWorkspace(value), {
    initialProps: { ...input, result: input.result as typeof input.result | null },
  });
  let pending: Promise<void> = Promise.resolve();
  act(() => {
    pending = hook.result.current.semantic.run(section);
  });
  expect(request).toHaveBeenCalledOnce();
  const changed = changedDesign(input);
  hook.rerender(changed);
  await act(async () => {
    finish({ kind: 'ok', findings: [], model: 'obsolete-model' });
    await pending;
  });
  expect(hook.result.current.semantic.forSection(section).status).toBe('idle');
  expect(hook.result.current.semantic.statusBySectionId[section.sectionId]).not.toBe('current');
  hook.rerender({ ...changed, result: null });
  expect(Object.values(hook.result.current.coverage!.byNodeId)[0].automatic.status).toBe('stale');
});
