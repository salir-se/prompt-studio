import { Button } from '@prompt-studio/ui/button';
import type { WorkspaceProject } from '../prompt-repo/prompt-repo-client';

export function ProjectSaveStatus({
  project,
  pending,
  error,
  requiredTools,
  onRetry,
  onOpenTools,
}: {
  project: WorkspaceProject | null;
  pending: number;
  error: string | null;
  requiredTools: readonly string[];
  onRetry: () => void;
  onOpenTools: () => void;
}) {
  if (!project) return null;
  const missing = requiredTools.filter((name) => !project.definitions.tools.some((tool) => tool.name === name));
  return (
    <>
      <div
        role="status"
        className="studio-save-status flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-muted/40 px-4 py-1.5 text-xs text-foreground"
      >
        <strong className="break-words">{project.name}</strong>
        <span className="rounded border border-border px-1.5 font-mono text-[11px]">{project.branch}</span>
        <span>{pending ? 'Saving changes…' : error ? 'Changes not saved' : 'Saved on this computer'}</span>
        {error && (
          <>
            <span className="break-words text-destructive">{error}</span>
            <Button type="button" variant="outline" size="sm" onClick={onRetry}>
              Retry saving
            </Button>
          </>
        )}
      </div>
      {missing.length > 0 && (
        <p role="status" className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2 text-xs">
          Missing tool definitions: {missing.join(', ')}.
          <Button type="button" variant="ghost" size="sm" onClick={onOpenTools}>
            Define tools
          </Button>
        </p>
      )}
    </>
  );
}
