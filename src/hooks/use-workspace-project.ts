import { useCallback, useEffect, useRef, useState } from 'react';
import { type ProjectDefinitions, validateProjectDefinitions } from '../prompt-repo/project-definitions';
import {
  type ProjectArchive,
  projectCommand,
  studioJson,
  type WorkspaceProject,
} from '../prompt-repo/prompt-repo-client';

export type ProjectPatch = {
  files?: readonly { path: string; text: string; expectedHash: string }[];
  documents?: readonly { readonly path: string; readonly text: string }[];
  definitions?: ProjectDefinitions;
};
interface Recovery {
  updatedAt?: number;
  revision: number;
  patches: (ProjectPatch & { mutationId?: string })[];
}
const recoveryKey = (projectId: string) => `prompt-studio-unsaved:${projectId}`;
export interface RecoveryBackup {
  key: string;
  recovery: Recovery;
}
function readRecovery(key: string): Recovery | null {
  const saved = localStorage.getItem(key);
  if (!saved) return null;
  try {
    const value = JSON.parse(saved) as Recovery;
    return Number.isSafeInteger(value.revision) && Array.isArray(value.patches) && value.patches.length > 0
      ? value
      : null;
  } catch {
    return null;
  }
}
function recoveryBackupsFor(projectId: string, ownedKey: string): RecoveryBackup[] {
  const prefix = recoveryKey(projectId);
  return Object.keys(localStorage)
    .filter((key) => key !== ownedKey && (key === prefix || key.startsWith(`${prefix}:`)))
    .flatMap((key) => {
      const saved = readRecovery(key);
      return saved ? [{ key, recovery: saved }] : [];
    });
}

/** Serial durable drafts, with project-scoped recovery until the server acknowledges them. */
export function useWorkspaceProject() {
  const enabled = typeof document !== 'undefined' && !!document.querySelector('meta[name="studio-workspace"]');
  const [editorId] = useState(() => crypto.randomUUID());
  const [recoveryBackups, setRecoveryBackups] = useState<RecoveryBackup[]>([]);
  const ownedKey = useCallback((projectId: string) => `${recoveryKey(projectId)}:${editorId}`, [editorId]);
  const [project, setProject] = useState<WorkspaceProject | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(0);
  const [busy, setBusy] = useState(false);
  const locked = useRef(false);
  const current = useRef<WorkspaceProject | null>(null);
  const queue = useRef<Promise<void>>(Promise.resolve());
  const recovery = useRef<Recovery>({ revision: 0, patches: [] });
  const blocked = useRef(false);
  const [generation, setGeneration] = useState(0);
  const loadGeneration = useRef(0);
  const accept = useCallback((next: WorkspaceProject) => {
    current.current = next;
    setProject(next);
  }, []);
  const writeRecovery = useCallback(() => {
    const identity = current.current?.projectId;
    if (!identity) return;
    if (recovery.current.patches.length) {
      recovery.current.updatedAt = Date.now();
      localStorage.setItem(ownedKey(identity), JSON.stringify(recovery.current));
    } else localStorage.removeItem(ownedKey(identity));
  }, [ownedKey]);
  const load = useCallback(async () => {
    const request = ++loadGeneration.current;
    setLoading(true);
    try {
      const next = await studioJson<WorkspaceProject | { open: false }>('/__studio/prompt-repo');
      if (request !== loadGeneration.current) return;
      if (next.open) {
        accept(next);
        recovery.current = { revision: next.revision, patches: [] };
        blocked.current = false;
        setRecoveryBackups(recoveryBackupsFor(next.projectId, ownedKey(next.projectId)));
        setError(null);
      }
    } catch (cause) {
      if (request === loadGeneration.current) setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (request === loadGeneration.current) setLoading(false);
    }
  }, [accept, ownedKey]);
  useEffect(() => {
    if (enabled) void load();
    return () => {
      loadGeneration.current += 1;
    };
  }, [enabled, load]);
  useEffect(() => {
    const guard = (event: BeforeUnloadEvent) => {
      if (recovery.current.patches.length) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', guard);
    return () => window.removeEventListener('beforeunload', guard);
  }, []);

  const enqueue = useCallback(
    (patch: ProjectPatch): Promise<void> => {
      const identity = current.current?.projectId;
      setPending((count) => count + 1);
      const operation = queue.current
        .then(async () => {
          const active = current.current;
          if (!active || active.projectId !== identity)
            throw new Error('Project changed before saving. Reopen your original project and retry.');
          if (blocked.current) throw new Error('Previous changes are unsaved. Retry saving before continuing.');
          const next = await projectCommand('draft', { projectId: identity, revision: active.revision, ...patch });
          accept(next);
          recovery.current.patches.shift();
          recovery.current.revision = next.revision;
          writeRecovery();
          setError(null);
        })
        .catch((cause) => {
          blocked.current = true;
          setError(cause instanceof Error ? cause.message : String(cause));
          throw cause;
        })
        .finally(() => setPending((count) => count - 1));
      queue.current = operation.catch(() => undefined);
      return operation;
    },
    [accept, writeRecovery],
  );
  const draft = useCallback(
    (patch: ProjectPatch): Promise<void> => {
      if (!current.current) return Promise.reject(new Error('Open a project first.'));
      if (patch.definitions) validateProjectDefinitions(patch.definitions);
      if (locked.current) return Promise.reject(new Error('Wait for the current project operation to finish.'));
      const queued = { ...patch, mutationId: crypto.randomUUID() };
      recovery.current.patches.push(queued);
      try {
        writeRecovery();
      } catch {
        blocked.current = true;
        const cause = new Error(
          'Browser recovery storage is unavailable. Your edits remain in this tab; export recovered changes or retry saving.',
        );
        setError(cause.message);
        return Promise.reject(cause);
      }
      return enqueue(queued);
    },
    [enqueue, writeRecovery],
  );
  const flush = useCallback(async () => {
    await queue.current;
    if (recovery.current.patches.length)
      throw new Error('Changes are not saved. Choose Retry saving before switching or publishing.');
  }, []);
  async function exclusive<T>(operation: () => Promise<T>, needsFlush = true): Promise<T> {
    if (locked.current) throw new Error('A project operation is already in progress.');
    locked.current = true;
    setBusy(true);
    try {
      if (needsFlush) await flush();
      return await operation();
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }
  async function retry({ keepEditor = false }: { keepEditor?: boolean } = {}): Promise<void> {
    if (!current.current) return load();
    await exclusive(async () => {
      await queue.current;
      const latest = await studioJson<WorkspaceProject>('/__studio/prompt-repo');
      if (!latest.open || latest.projectId !== current.current?.projectId)
        throw new Error('A different project is open. Reopen the original project before recovering changes.');
      const revisionDelta = latest.revision - recovery.current.revision;
      const first = recovery.current.patches[0];
      const acknowledged =
        revisionDelta === 1 &&
        first?.mutationId !== undefined &&
        latest.lastDraft?.mutationId === first.mutationId &&
        latest.lastDraft.revision === latest.revision
          ? 1
          : 0;
      if (revisionDelta !== acknowledged) {
        const message =
          'The saved project changed since these edits. Export recovered changes, or keep the saved version and discard your recovered edits.';
        setError(message);
        throw new Error(message);
      }
      // Only the server's durable receipt identifies our lost request. Matching content alone
      // cannot distinguish a no-op draft from another tab's concurrent mutation.
      recovery.current.patches.splice(0, acknowledged);
      recovery.current.revision = latest.revision;
      accept(latest);
      if (acknowledged > 0) writeRecovery();
      blocked.current = false;
      const patches = [...recovery.current.patches];
      for (const patch of patches) await enqueue(patch);
      setError(null);
      if (!keepEditor) setGeneration((value) => value + 1);
    }, false);
  }
  async function reopenOriginalProject(): Promise<void> {
    await exclusive(async () => {
      await queue.current;
      const projectId = current.current?.projectId;
      if (!projectId) throw new Error('There is no original project to reopen.');
      const latest = await projectCommand('resume', { projectId });
      if (latest.projectId !== projectId) throw new Error('The original project could not be reopened.');
      accept(latest);
      setError(
        'Original project reopened. Your recovered edits are retained. Retry saving or choose a recovery option.',
      );
    }, false);
  }
  async function keepSavedVersion(): Promise<void> {
    await exclusive(async () => {
      await queue.current;
      const latest = await studioJson<WorkspaceProject>('/__studio/prompt-repo');
      if (!latest.open || latest.projectId !== current.current?.projectId)
        throw new Error('A different project is open. Reopen the original project before discarding recovered edits.');
      // This command is exposed only after an explicit destructive-action confirmation.
      localStorage.removeItem(ownedKey(latest.projectId));
      recovery.current = { revision: latest.revision, patches: [] };
      blocked.current = false;
      accept(latest);
      setError(null);
      setGeneration((value) => value + 1);
    }, false);
  }
  async function switchProject(command: 'new' | 'open' | 'resume' | 'import', input: unknown): Promise<void> {
    await exclusive(async () => {
      const next = await projectCommand(command, input);
      accept(next);
      recovery.current = { revision: next.revision, patches: [] };
      blocked.current = false;
      setRecoveryBackups(recoveryBackupsFor(next.projectId, ownedKey(next.projectId)));
      setGeneration((value) => value + 1);
      setError(null);
    });
  }
  async function recoverBackup(key: string): Promise<void> {
    await exclusive(async () => {
      const projectId = current.current?.projectId;
      if (!projectId) throw new Error('Open the backup’s project first.');
      const prefix = recoveryKey(projectId);
      if (key === ownedKey(projectId) || (key !== prefix && !key.startsWith(`${prefix}:`)))
        throw new Error('This backup belongs to a different project.');
      // Re-read on explicit selection: another live editor may have changed or acknowledged it.
      const saved = readRecovery(key);
      if (!saved) throw new Error('This backup is no longer available. Its editor may have saved it.');
      recovery.current = saved;
      blocked.current = true;
      setError(
        'Copied recovered changes into this editor. Retry saving to recover your work. The original backup is retained.',
      );
      writeRecovery();
    });
  }
  async function removeRecoveryBackup(key: string): Promise<void> {
    await exclusive(async () => {
      const projectId = current.current?.projectId;
      if (!projectId) throw new Error('Open the backup’s project first.');
      const prefix = recoveryKey(projectId);
      if (key === ownedKey(projectId) || (key !== prefix && !key.startsWith(`${prefix}:`)))
        throw new Error('Only a backup from another session of this project can be removed.');
      // The panel requires explicit confirmation because this may be another live editor's only backup.
      localStorage.removeItem(key);
      setRecoveryBackups(recoveryBackupsFor(projectId, ownedKey(projectId)));
    }, false);
  }
  async function save(message: string): Promise<void> {
    await exclusive(async () => {
      if (!current.current) throw new Error('Open or create a project first.');
      const { projectId, revision } = current.current;
      accept(await projectCommand('save', { projectId, revision, message }));
      recovery.current.revision = current.current.revision;
    });
  }
  async function restore(path: string, commit: string): Promise<void> {
    await exclusive(async () => {
      if (!current.current) throw new Error('Open a project first.');
      const { projectId, revision } = current.current;
      accept(await projectCommand('restore', { projectId, revision, path, commit }));
      recovery.current.revision = current.current.revision;
      setGeneration((value) => value + 1);
    });
  }
  async function exportProject(): Promise<ProjectArchive> {
    return exclusive(() => {
      if (!current.current) throw new Error('Open a project first.');
      const { projectId, revision } = current.current;
      const query = new URLSearchParams({ projectId, revision: String(revision) });
      return studioJson<ProjectArchive>(`/__studio/prompt-repo/export?${query}`);
    });
  }
  async function publish(input: {
    url?: string;
    branch: string;
    title: string;
    body?: string;
  }): Promise<{ url: string }> {
    return exclusive(async () => {
      if (!current.current) throw new Error('Open or create a project first.');
      const { projectId, revision } = current.current;
      const result = await projectCommand<{ url: string }>('publish', { projectId, revision, ...input });
      accept(await studioJson<WorkspaceProject>('/__studio/prompt-repo'));
      recovery.current.revision = current.current.revision;
      return result;
    });
  }
  return {
    enabled,
    recoveryBackups,
    recoverBackup,
    removeRecoveryBackup,
    project,
    generation,
    loading,
    error,
    pending,
    busy,
    draft,
    flush,
    retry,
    keepSavedVersion,
    reopenOriginalProject,
    switchProject,
    save,
    restore,
    exportProject,
    publish,
    exportRecovery: () => recovery.current,
  };
}
type Controller = ReturnType<typeof useWorkspaceProject>;
export type WorkspaceProjectController = Omit<
  Controller,
  'recoveryBackups' | 'recoverBackup' | 'removeRecoveryBackup'
> &
  Partial<Pick<Controller, 'recoveryBackups' | 'recoverBackup' | 'removeRecoveryBackup'>>;
