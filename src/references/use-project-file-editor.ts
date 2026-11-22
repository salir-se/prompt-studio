import { useCallback, useEffect, useRef, useState } from 'react';
import { promptDesignProviderKey, serializePromptDesign } from '../design/prompt-design-project';
import type { DocumentEditor } from '../hooks/use-document-editor';
import type { HistoryBoot } from '../hooks/use-history-boot';
import type { WorkspaceProjectController } from '../hooks/use-workspace-project';
import { studioJson } from '../prompt-repo/prompt-repo-client';
import { readWorkspacePrompt, workspaceFileForDesign } from '../prompt-repo/workspace-document';

type OpenFile = { path: string; text: string; hash: string };
export function useProjectFileEditor(
  workspace: WorkspaceProjectController,
  boot: HistoryBoot,
  editor: DocumentEditor,
  onClose: () => void,
) {
  const [file, setFile] = useState<OpenFile>();
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();
  const [saved, setSaved] = useState(false);
  const request = useRef(0);
  const opener = useRef<HTMLElement | null>(null);
  const native = file ? readWorkspacePrompt(file.text) : null;
  const baseline = native?.text ?? file?.text ?? '';
  const dirty = !!file && draft !== baseline;
  const recoveryKey = useCallback(
    (path: string) => `prompt-studio-file:${workspace.project?.projectId}:${path}`,
    [workspace.project?.projectId],
  );
  useEffect(() => {
    if (!file) return;
    try {
      if (dirty) sessionStorage.setItem(recoveryKey(file.path), JSON.stringify({ hash: file.hash, text: draft }));
      else sessionStorage.removeItem(recoveryKey(file.path));
    } catch {
      setError('Browser recovery storage is unavailable. Keep this tab open and save or copy your draft.');
    }
  }, [file, draft, dirty, recoveryKey]);
  useEffect(
    () => () => {
      request.current++;
    },
    [],
  );
  function clearRecovery(path: string) {
    try {
      sessionStorage.removeItem(recoveryKey(path));
    } catch {
      // Unavailable recovery storage must not trap the user in a closed or discarded file.
    }
  }
  function discard() {
    if (file) clearRecovery(file.path);
    request.current++;
    setFile(undefined);
    setError(undefined);
    setLoading(false);
  }
  function canLeave() {
    return !saving && (!dirty || window.confirm('Discard unsaved changes to the referenced file?'));
  }
  async function open(path: string, returnFocus?: HTMLElement | null) {
    if (!workspace.project || !canLeave()) return;
    if (file && dirty) clearRecovery(file.path);
    opener.current = returnFocus ?? (document.activeElement as HTMLElement);
    const generation = ++request.current;
    setLoading(true);
    setError(undefined);
    setFile(undefined);
    setSaved(false);
    const query = new URLSearchParams({
      projectId: workspace.project.projectId,
      revision: String(workspace.project.revision),
      path,
    });
    try {
      const next = await studioJson<OpenFile>(`/__studio/prompt-repo/file?${query}`);
      if (generation !== request.current) return;
      let savedDraft: string | null = null;
      try {
        savedDraft = sessionStorage.getItem(recoveryKey(path));
      } catch {
        setError('Browser recovery storage is unavailable. Keep this tab open until you save your edits.');
      }
      let recovered: { hash: string; text: string } | undefined;
      try {
        const value = savedDraft ? JSON.parse(savedDraft) : null;
        if (typeof value?.hash === 'string' && typeof value.text === 'string') recovered = value;
      } catch {
        /* A malformed cache must not prevent opening the saved file. */
      }
      if (recovered?.text === (readWorkspacePrompt(next.text)?.text ?? next.text)) recovered = undefined;
      setFile(recovered ? { ...next, hash: recovered.hash } : next);
      setDraft(recovered?.text ?? readWorkspacePrompt(next.text)?.text ?? next.text);
      if (recovered)
        setError(
          recovered.hash === next.hash
            ? 'Recovered unsaved file edits. Review and save when ready.'
            : 'Recovered edits belong to an older file. Copy your draft, close the file, and reopen the saved version before merging.',
        );
    } catch (cause) {
      if (generation === request.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (generation === request.current) setLoading(false);
    }
  }
  async function save() {
    if (!file || saving || !dirty) return;
    const generation = request.current;
    setSaving(true);
    setError(undefined);
    setSaved(false);
    const raw = native ? workspaceFileForDesign(native.design, draft, native.configuration).text : draft;
    try {
      await workspace.draft({ files: [{ path: file.path, text: raw, expectedHash: file.hash }] });
      const hash = Array.from(
        new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw))),
        (v) => v.toString(16).padStart(2, '0'),
      ).join('');
      if (generation === request.current) {
        setFile({ ...file, text: raw, hash });
        setSaved(true);
      }
      const document = workspace.project?.documents.find((candidate) => candidate.path === file.path);
      if (document && boot.history) {
        const { provider, activeProjectId } = boot.history;
        await provider.commit({
          projectId: activeProjectId,
          rootKey: document.id,
          text: draft,
          message: `Edit ${file.path}`,
        });
        const design = readWorkspacePrompt(raw)?.design;
        if (design)
          await provider.commit({
            projectId: activeProjectId,
            rootKey: promptDesignProviderKey(document.id),
            text: serializePromptDesign(design),
            message: `Update ${file.path} design`,
          });
        await provider.persist();
        const roots = await boot.refreshAuthoredRoots(activeProjectId);
        const root = roots.find((candidate) => candidate.id === document.id);
        if (generation === request.current && root && editor.selectedRootId === root.id) editor.loadDocument(root);
      }
    } catch (cause) {
      if (generation === request.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  }
  return {
    file,
    draft,
    dirty,
    loading,
    saving,
    error,
    saved,
    active: !!file || loading || !!error,
    change(text: string) {
      setDraft(text);
      setSaved(false);
    },
    open,
    save,
    discard,
    close() {
      if (canLeave()) {
        const target = opener.current;
        discard();
        onClose();
        const generation = request.current;
        // Wait for the inspector and its inert canvas boundary to unmount before restoring focus.
        requestAnimationFrame(() => {
          if (generation === request.current && target?.isConnected) target.focus();
        });
      }
    },
  };
}
export type ProjectFileEditor = ReturnType<typeof useProjectFileEditor>;
