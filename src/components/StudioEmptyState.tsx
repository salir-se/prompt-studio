import { Button } from '@prompt-studio/ui/button';
import { StudioMark } from './StudioMark';

export function StudioEmptyState({
  canCreate,
  onCreate,
  onOpenProject,
}: {
  canCreate: boolean;
  onCreate: () => void;
  onOpenProject: () => void;
}) {
  return (
    <section aria-label="Get started" className="flex flex-1 items-center justify-center p-6">
      <div className="studio-empty max-w-xl space-y-5 rounded-2xl border border-border bg-card p-10 shadow-sm">
        <StudioMark />
        <h2 className="text-3xl font-semibold tracking-tight">No prompt open</h2>
        <p className="text-sm leading-6 text-muted-foreground">
          Choose a prompt in Explorer or create a new one. Write its instructions, define inputs and tools, then inspect
          the resulting prompt.
        </p>
        <div className="grid grid-cols-3 gap-4 border-y border-border py-4 text-xs text-muted-foreground">
          <span>
            <strong className="mb-1 block text-foreground">01 · Write</strong>Shape the instructions
          </span>
          <span>
            <strong className="mb-1 block text-foreground">02 · Verify</strong>Check the requirements
          </span>
          <span>
            <strong className="mb-1 block text-foreground">03 · Review</strong>Inspect source and history
          </span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" disabled={!canCreate} onClick={onCreate}>
            Create a prompt
          </Button>
          <Button type="button" variant="outline" onClick={onOpenProject}>
            Open a project
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">Work stays on this computer until you choose to share it.</p>
      </div>
    </section>
  );
}
