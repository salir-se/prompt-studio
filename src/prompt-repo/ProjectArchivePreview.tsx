import { Button } from '@prompt-studio/ui/button';
import type { ProjectArchive } from './prompt-repo-client';

export function ProjectArchivePreview({
  archive,
  busy,
  onImport,
  onCancel,
}: {
  archive: ProjectArchive;
  busy: boolean;
  onImport: () => void;
  onCancel: () => void;
}) {
  const button = 'rounded border border-input px-3 py-2 text-sm disabled:opacity-50';
  return (
    <div className="grid gap-2 rounded border p-3">
      <p>
        Import “{archive.name}” with {archive.files.length} files as a new project. Your current project will remain
        saved separately.
      </p>
      <details>
        <summary className="cursor-pointer text-sm">Included files</summary>
        <ul className="mt-2 max-h-48 overflow-y-auto text-xs font-mono">
          {archive.files.map((file) => (
            <li key={file.path} className="break-all py-1">
              {file.path}
            </li>
          ))}
        </ul>
      </details>
      <p className="text-xs text-muted-foreground">
        This archive contains project files. Git history, credentials and local evaluation results are excluded.
      </p>
      <Button variant="outline" type="button" className={button} disabled={busy} onClick={onImport}>
        Import as new project
      </Button>
      <Button variant="outline" type="button" className={button} onClick={onCancel}>
        Cancel import
      </Button>
    </div>
  );
}
