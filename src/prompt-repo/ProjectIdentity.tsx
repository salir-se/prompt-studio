import { ThemeToggle } from '../ThemeToggle';
import { StudioMark } from '../components/StudioMark';
import type { WorkspaceProject } from './prompt-repo-client';

export function ProjectWelcome() {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <StudioMark />
          <p className="text-sm font-semibold">Prompt Studio</p>
        </div>
        <ThemeToggle className="rounded-md border border-border p-2 hover:bg-muted" />
      </div>
      <h1 className="max-w-2xl pt-5 text-4xl font-semibold tracking-tight">A workspace for better prompts.</h1>
      <p className="max-w-xl text-base leading-7 text-muted-foreground">
        Write, verify and compare prompts in one project. Start a new collection or bring an existing repository.
      </p>
      <p className="text-xs text-muted-foreground">
        Saved on this computer. Connect a model to run; share only when you choose.
      </p>
    </div>
  );
}

export function CurrentProjectSummary({
  project,
  pending,
  error,
}: {
  project: WorkspaceProject;
  pending: number;
  error: string | null;
}) {
  return (
    <section aria-label="Current project" className="space-y-3 rounded-xl border border-border bg-muted/20 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-base font-semibold">{project.name}</h3>
        <span className="rounded-full border border-border bg-background px-2 py-1 text-xs">
          {project.documents.length} prompts
        </span>
      </div>
      <p className="break-all text-xs leading-5 text-muted-foreground">
        {project.remote ?? 'Local project · no remote repository connected'}
      </p>
      <dl className="flex flex-wrap gap-x-6 gap-y-2 text-xs">
        <div>
          <dt className="text-muted-foreground">Branch</dt>
          <dd className="mt-1 font-mono">{project.branch}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Local revision</dt>
          <dd className="mt-1 font-mono">{project.revision}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        {error
          ? 'Saving needs attention. Recovered changes are available below.'
          : pending > 0
            ? 'Saving applied edits on this computer…'
            : 'Applied edits saved on this computer.'}
      </p>
    </section>
  );
}
