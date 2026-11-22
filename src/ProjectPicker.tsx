/**
 * `ProjectPicker` — the top bar's compact prompt-project control (ADR-203 Stage C2). Pure and
 * prop-driven: it renders the project list the App hands it and reports intent through callbacks —
 * it never imports or talks to a `HistoryProvider` itself (only the `ProjectRef` shape), so the
 * provider stays swappable behind the App and this component tests without any history machinery.
 *
 * The trigger shows the active project's name; clicking it opens a small popover listing every
 * project (active marked with `aria-current`), with New / Rename / Duplicate / Delete actions.
 * New, Rename, and Duplicate share one inline name form (an empty or whitespace-only name is never
 * submitted); Delete requires a second click ("Confirm delete") and is disabled while only one
 * project exists — the studio always has an active project to commit to. Escape closes the popover
 * and drops any half-entered state.
 */

import { Popover } from '@prompt-studio/ui/popover';
import { useEffect, useState } from 'react';
import type { ProjectRef } from './vcs/history-provider';

/** Same minimal `clsx` stand-in App.tsx uses — see its doc for why `@prompt-studio/ui`'s `cn` is out of reach. */
function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(' ');
}

// Mirrors App.tsx's button vocabulary so the picker reads as part of the existing top bar.
const BUTTON_BASE_CLASSES =
  'inline-flex shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-md text-xs font-medium transition-colors disabled:pointer-events-none disabled:opacity-50';
const BUTTON_SM_CLASSES = 'h-7 px-2.5';
const BUTTON_OUTLINE_CLASSES = 'border border-border bg-card hover:bg-muted';
const ROW_ACTION_CLASSES =
  'rounded-sm px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground';

/** One selectable starting configuration in the New form (ADR-235). */
export interface ConfigurationOption {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly positioning: 'shipped' | 'reference';
}

/** Which of the three name-taking actions the inline form is currently collecting a name for. */
type PendingAction = { kind: 'create' } | { kind: 'rename'; id: string } | { kind: 'duplicate'; id: string };

const SUBMIT_LABELS: Record<PendingAction['kind'], string> = {
  create: 'Create configuration',
  rename: 'Rename configuration',
  duplicate: 'Duplicate configuration',
};

export interface ProjectPickerProps {
  projects: readonly ProjectRef[];
  /** `null` renders a nameless trigger — the App only mounts the picker once a project is active. */
  activeId: string | null;
  /** Starting configurations for the New form (manifest baselines; first entry should be the shipped default). */
  baselines: readonly ConfigurationOption[];
  onSwitch: (id: string) => void;
  /** `baselineId` names the starting configuration to seed from (`'default'` = ship as-is). */
  onCreate: (name: string, baselineId: string) => void;
  onRename: (id: string, name: string) => void;
  onDuplicate: (id: string, name: string) => void;
  onDelete: (id: string) => void;
  /** "Reset to starting configuration" — same two-click confirm shape as Delete. */
  onReset: (id: string) => void;
}

export function ProjectPicker({
  projects,
  activeId,
  baselines,
  onSwitch,
  onCreate,
  onRename,
  onDuplicate,
  onDelete,
  onReset,
}: ProjectPickerProps): React.JSX.Element {
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [nameValue, setNameValue] = useState('');
  /** The New form's selected starting configuration; defaults to the first (shipped) baseline. */
  const [baselineId, setBaselineId] = useState(baselines[0]?.id ?? 'default');
  /** Project id whose Delete button is one click away from actually deleting — the two-click guard. */
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  /** Project id whose Reset button is one click away from actually resetting — same guard shape. */
  const [confirmResetId, setConfirmResetId] = useState<string | null>(null);

  const activeProject = projects.find((project) => project.id === activeId);
  const isLastProject = projects.length <= 1;

  function closeMenu(): void {
    setOpen(false);
    setPending(null);
    setNameValue('');
    setConfirmDeleteId(null);
    setConfirmResetId(null);
  }

  // Escape closes the popover (same pattern as App.tsx's drawer listener) — active only while open.
  // Calls the stable setters directly (mirroring `closeMenu`) so the effect depends only on `open`.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'Escape') return;
      setOpen(false);
      setPending(null);
      setNameValue('');
      setConfirmDeleteId(null);
      setConfirmResetId(null);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open]);

  /** Opens the inline name form for `action`, prefilled per action kind (see the call sites). */
  function beginAction(action: PendingAction, prefill: string): void {
    setPending(action);
    setNameValue(prefill);
    setConfirmDeleteId(null);
    setConfirmResetId(null);
  }

  function handleSubmitName(event: React.FormEvent): void {
    event.preventDefault();
    const name = nameValue.trim();
    if (name === '' || pending === null) return; // An empty name is never submitted.
    if (pending.kind === 'create') onCreate(name, baselineId);
    else if (pending.kind === 'rename') onRename(pending.id, name);
    else onDuplicate(pending.id, name);
    closeMenu();
  }

  function handleDeleteClick(id: string): void {
    if (confirmDeleteId !== id) {
      setConfirmDeleteId(id); // First click arms; only the second click deletes.
      return;
    }
    onDelete(id);
    closeMenu();
  }

  function handleResetClick(id: string): void {
    if (confirmResetId !== id) {
      setConfirmResetId(id); // Same two-click shape as Delete — a reset rewrites every document.
      return;
    }
    onReset(id);
    closeMenu();
  }

  return (
    <Popover.Root open={open} onOpenChange={(next) => (next ? setOpen(true) : closeMenu())}>
      <Popover.Trigger
        type="button"
        data-testid="project-picker-trigger"
        aria-haspopup="true"
        aria-expanded={open}
        title="Switch or manage prompt configurations"
        className={cn(BUTTON_BASE_CLASSES, BUTTON_SM_CLASSES, BUTTON_OUTLINE_CLASSES, 'max-w-[180px]')}
      >
        <span className="text-muted-foreground">Config:</span>
        <span className="truncate">{activeProject?.name ?? 'none'}</span>
      </Popover.Trigger>

      {open && (
        <Popover.Portal>
          <Popover.Positioner sideOffset={8} align="start" collisionPadding={12} className="z-50">
            <Popover.Popup
              role="dialog"
              aria-label="Projects"
              data-testid="project-picker-menu"
              className="studio flex max-h-[var(--available-height)] w-[400px] max-w-[calc(100vw-24px)] flex-col gap-3 overflow-y-auto rounded-xl border border-border bg-card p-3 shadow-xl"
            >
              <div className="space-y-1 border-b border-border pb-3">
                <h2 className="text-sm font-semibold">Developer configurations</h2>
                <p className="text-xs text-muted-foreground">Choose a saved configuration for this manifest.</p>
              </div>
              <ul aria-label="Project list" className="flex flex-col gap-0.5">
                {projects.map((project) => (
                  <li key={project.id} className="flex flex-wrap gap-1 rounded-lg border border-border p-2">
                    <button
                      type="button"
                      aria-current={project.id === activeId ? 'true' : undefined}
                      title={project.name}
                      onClick={() => {
                        onSwitch(project.id);
                        closeMenu();
                      }}
                      className={cn(
                        'w-full min-w-0 truncate rounded-md px-2 py-2 text-left text-sm',
                        project.id === activeId ? 'bg-accent font-medium text-accent-foreground' : 'hover:bg-muted',
                      )}
                    >
                      {project.name}
                    </button>
                    <button
                      type="button"
                      aria-label={`Rename ${project.name}`}
                      onClick={() => beginAction({ kind: 'rename', id: project.id }, project.name)}
                      className={ROW_ACTION_CLASSES}
                    >
                      Rename
                    </button>
                    <button
                      type="button"
                      aria-label={`Duplicate ${project.name}`}
                      onClick={() => beginAction({ kind: 'duplicate', id: project.id }, `${project.name} copy`)}
                      className={ROW_ACTION_CLASSES}
                    >
                      Duplicate
                    </button>
                    <button
                      type="button"
                      aria-label={
                        confirmResetId === project.id
                          ? `Confirm reset ${project.name}`
                          : `Reset ${project.name} to its starting configuration`
                      }
                      title="Commit every document back to this configuration's starting point"
                      onClick={() => handleResetClick(project.id)}
                      className={cn(
                        ROW_ACTION_CLASSES,
                        confirmResetId === project.id && 'font-medium text-destructive',
                      )}
                    >
                      {confirmResetId === project.id ? 'Confirm reset' : 'Reset'}
                    </button>
                    <button
                      type="button"
                      aria-label={
                        confirmDeleteId === project.id ? `Confirm delete ${project.name}` : `Delete ${project.name}`
                      }
                      disabled={isLastProject}
                      title={isLastProject ? 'The last project cannot be deleted.' : undefined}
                      onClick={() => handleDeleteClick(project.id)}
                      className={cn(
                        ROW_ACTION_CLASSES,
                        confirmDeleteId === project.id && 'font-medium text-destructive',
                      )}
                    >
                      {confirmDeleteId === project.id ? 'Confirm delete' : 'Delete'}
                    </button>
                  </li>
                ))}
              </ul>

              <div className="border-t border-border pt-2">
                {pending === null ? (
                  <button
                    type="button"
                    aria-label="New configuration"
                    onClick={() => beginAction({ kind: 'create' }, '')}
                    className={cn(BUTTON_BASE_CLASSES, BUTTON_SM_CLASSES, BUTTON_OUTLINE_CLASSES, 'w-full')}
                  >
                    New configuration
                  </button>
                ) : (
                  <form onSubmit={handleSubmitName} className="flex flex-col gap-1.5">
                    <div className="flex items-center gap-1.5">
                      <input
                        autoFocus
                        aria-label="Configuration name"
                        value={nameValue}
                        onChange={(event) => setNameValue(event.target.value)}
                        className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
                      />
                      <button
                        type="submit"
                        aria-label={SUBMIT_LABELS[pending.kind]}
                        disabled={nameValue.trim() === ''}
                        className={cn(
                          BUTTON_BASE_CLASSES,
                          BUTTON_SM_CLASSES,
                          'bg-primary text-primary-foreground hover:bg-primary/90',
                        )}
                      >
                        {pending.kind === 'create' ? 'Create' : SUBMIT_LABELS[pending.kind].split(' ')[0]}
                      </button>
                    </div>
                    {pending.kind === 'create' && (
                      <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <span className="shrink-0">Start from</span>
                        <select
                          aria-label="Starting configuration"
                          value={baselineId}
                          onChange={(event) => setBaselineId(event.target.value)}
                          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-1 text-xs text-foreground"
                        >
                          {baselines.map((baseline) => (
                            <option key={baseline.id} value={baseline.id} title={baseline.description}>
                              {baseline.label}
                            </option>
                          ))}
                        </select>
                      </label>
                    )}
                  </form>
                )}
              </div>
            </Popover.Popup>
          </Popover.Positioner>
        </Popover.Portal>
      )}
    </Popover.Root>
  );
}
