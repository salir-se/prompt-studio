import { Button } from '@prompt-studio/ui/button';
import { useEffect, useRef, useState } from 'react';
import type { WorkspaceProjectController } from '../hooks/use-workspace-project';
import { downloadProjectJson } from './project-download';

export function ProjectRecovery({
  workspace,
  error,
  busy,
  run,
}: {
  workspace?: WorkspaceProjectController;
  error?: string;
  busy: boolean;
  run: (action: () => Promise<void>) => Promise<void>;
}) {
  const [discardRecovery, setDiscardRecovery] = useState(false);
  const [removingBackup, setRemovingBackup] = useState<string | null>(null);
  const alertRef = useRef<HTMLParagraphElement>(null);
  const message = error || workspace?.error;
  useEffect(() => {
    if (!message) return;
    alertRef.current?.scrollIntoView?.({ block: 'nearest' });
    alertRef.current?.focus({ preventScroll: true });
  }, [message]);
  const button = 'h-auto min-h-9 whitespace-normal text-left';
  return (
    <>
      {message && (
        <p
          ref={alertRef}
          tabIndex={-1}
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
        >
          {message}
        </p>
      )}
      {workspace?.error && (
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" className={button} type="button" onClick={() => void run(workspace.retry)}>
            Retry saving
          </Button>
          <Button
            variant="outline"
            className={button}
            type="button"
            onClick={() => void run(workspace.reopenOriginalProject)}
          >
            Reopen original project
          </Button>
          <Button
            variant="outline"
            className={button}
            type="button"
            onClick={() => downloadProjectJson(workspace.exportRecovery(), 'recovered-prompt-changes.json')}
          >
            Export recovered changes
          </Button>
          <Button variant="outline" className={button} type="button" onClick={() => setDiscardRecovery(true)}>
            Keep saved version
          </Button>
        </div>
      )}
      {discardRecovery && (
        <section aria-label="Discard recovered edits" className="rounded border p-3">
          <p>
            Your recovered edits will be discarded. The version saved on this computer will remain. Export recovered
            changes first if you need to keep a copy.
          </p>
          <Button
            variant="outline"
            className={button}
            type="button"
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await workspace?.keepSavedVersion();
                setDiscardRecovery(false);
              })
            }
          >
            Discard recovered edits and keep saved version
          </Button>
          <Button variant="outline" className={button} type="button" onClick={() => setDiscardRecovery(false)}>
            Cancel
          </Button>
        </section>
      )}
      {(workspace?.recoveryBackups?.length ?? 0) > 0 && (
        <section aria-label="Saved recovery backups" className="grid gap-2 rounded border p-3">
          <h3 className="font-semibold">Recover edits from another session</h3>
          <p className="text-sm">
            These edits may belong to another open tab or an earlier session. Copy a backup here, then retry saving. The
            original backup stays available; changes to the saved project will require review.
          </p>
          {workspace?.recoveryBackups?.map((backup, index) => (
            <div key={backup.key} className="grid gap-2 rounded border p-2">
              <p>
                Backup {index + 1} · {backup.recovery.patches.length} unsaved edits
                {backup.recovery.updatedAt
                  ? ` · ${new Date(backup.recovery.updatedAt).toLocaleString()}`
                  : ' · Earlier session'}
              </p>
              <Button
                variant="outline"
                type="button"
                className={button}
                disabled={busy}
                onClick={() => void run(async () => workspace?.recoverBackup?.(backup.key))}
              >
                Copy backup {index + 1} into this editor
              </Button>
              <Button
                variant="outline"
                type="button"
                className={button}
                onClick={() => downloadProjectJson(backup.recovery, `recovered-prompt-backup-${index + 1}.json`)}
              >
                Export backup {index + 1}
              </Button>
              <Button
                variant="outline"
                type="button"
                className={button}
                disabled={busy}
                onClick={() => setRemovingBackup(backup.key)}
              >
                Remove backup {index + 1}
              </Button>
              {removingBackup === backup.key && (
                <section aria-label="Remove recovery backup" className="grid gap-2 rounded border p-3">
                  <p>
                    This backup may belong to another open editor. Removing it deletes its saved recovery copy. Export
                    the backup first if you need to keep it.
                  </p>
                  <Button
                    variant="outline"
                    type="button"
                    className={button}
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await workspace?.removeRecoveryBackup?.(backup.key);
                        setRemovingBackup(null);
                      })
                    }
                  >
                    Permanently remove backup
                  </Button>
                  <Button variant="outline" type="button" className={button} onClick={() => setRemovingBackup(null)}>
                    Cancel removal
                  </Button>
                </section>
              )}
            </div>
          ))}
        </section>
      )}
    </>
  );
}
