import { Badge } from '@prompt-studio/ui/badge';
import { Button } from '@prompt-studio/ui/button';
import { ButtonGroup } from '@prompt-studio/ui/button-group';
import {
  Braces,
  Download,
  Ellipsis,
  FileCheck,
  FileInput,
  FilePenLine,
  FlaskConical,
  FolderOpen,
  GitCompareArrows,
  History,
  PanelLeft,
  Play,
  Share2,
  ShieldCheck,
  Undo2,
  Upload,
  Workflow,
  Wrench,
} from '@prompt-studio/ui/icons';
import { ThemeToggle } from '../ThemeToggle';
import type { CatalogRoot } from '../catalog/root-catalog';
import { ShortcutHelpMenu } from '../shortcuts/ShortcutEducation';
import { ToolbarButton } from '../shortcuts/ToolbarButton';
import { useShortcutEducation } from '../shortcuts/shortcut-context';
import { StudioCommandMenu } from './StudioCommandMenu';
import { StudioMark } from './StudioMark';
import { cn } from './ui-classes';

export interface TopBarProps {
  selectedRoot: CatalogRoot | undefined;
  view?: 'write' | 'graph';
  explorerOpen?: boolean;
  onViewChange?: (view: 'write' | 'graph') => void;
  onBrowsePrompts?: () => void;
  activePanel?: string | null;
  isDirty: boolean;
  persistence?: 'workspace' | 'browser';
  canUndo: boolean;
  onUndo: () => void;
  /** The `ProjectPicker` element once the history provider booted; `null` while booting (ADR-203). */
  projectPicker: React.ReactNode;
  canCreatePrompt: boolean;
  onCreatePrompt: () => void;
  onAddExisting?: () => void;
  onAdaptDocument?: () => void;
  canOpenDesign: boolean;
  onOpenDesign: () => void;
  /** Disabled (with a tooltip) until a document is loaded — Final prompt has no text to resolve otherwise. */
  canOpenFinalPrompt: boolean;
  onOpenFinalPrompt: () => void;
  onOpenTools: () => void;
  onOpenVariables: () => void;
  /** `undefined` when Verify is enabled; otherwise the tooltip explaining why it's disabled. */
  verifyDisabledReason: string | undefined;
  onVerify: () => void;
  /** `undefined` when History is enabled; otherwise the tooltip explaining why it's disabled (like Verify's). */
  historyDisabledReason: string | undefined;
  onOpenHistory: () => void;
  /** The in-app help assistant (z.ai) — always available, never gated on a loaded document. */
  helpOpen: boolean;
  onOpenHelp: () => void;
  /** Export needs a loaded document to serialize — disabled (with a tooltip) until one exists. */
  canExport: boolean;
  onExport: () => void;
  /** Import is always enabled — a missing root selection is reported by the handler, not a disabled button. */
  onImport: () => void;
  /** Opens the plain-language editor for the person's own prompt repository. */
  onOpenPrompts: () => void;
  onOpenRun?: () => void;
  onOpenEvaluations?: () => void;
  onOpenVersions?: () => void;
  onOpenShare?: () => void;
}

/** Desktop-style project commands, followed by the selected prompt's tools. */
export function TopBar(props: TopBarProps): React.JSX.Element {
  const education = useShortcutEducation();
  const compact = 'h-8 px-2.5 text-xs';
  return (
    <header className="studio-topbar shrink-0 bg-card">
      <div className="studio-project-commands flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-border px-4 py-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="studio-brand mr-3 flex items-center gap-2.5 text-base font-semibold tracking-tight">
            <StudioMark />
            Prompt Studio
          </span>
          <ToolbarButton
            type="button"
            variant="ghost"
            className="hidden md:inline-flex"
            onClick={props.onOpenPrompts}
            label="Your prompts"
            icon={<FolderOpen className="size-4" />}
          />
          {props.projectPicker}
          <Button
            type="button"
            variant="default"
            size="sm"
            onClick={props.onCreatePrompt}
            disabled={!props.canCreatePrompt}
            className="w-11 px-0 md:w-auto md:px-3"
            aria-label="New prompt"
            title="New prompt"
          >
            <span aria-hidden="true" className="text-lg md:hidden">
              +
            </span>
            <span className="hidden md:inline">New prompt</span>
          </Button>
          {props.onAddExisting && (
            <ToolbarButton
              type="button"
              variant="outline"
              onClick={props.onAddExisting}
              aria-keyshortcuts="Alt+A"
              className="hidden md:inline-flex"
              label="Add existing"
              icon={<FileInput className="size-4" />}
              shortcut="addExisting"
            />
          )}
          {props.onOpenVersions && (
            <ToolbarButton
              type="button"
              variant="ghost"
              className="hidden md:inline-flex"
              onClick={props.onOpenVersions}
              label="Versions"
              icon={<GitCompareArrows className="size-4" />}
            />
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="md:hidden">
            <StudioCommandMenu
              label="File"
              commands={[
                { label: 'Your prompts', run: props.onOpenPrompts },
                ...(props.onAddExisting
                  ? [{ label: 'Add existing', run: props.onAddExisting, shortcut: 'addExisting' as const }]
                  : []),
                ...(props.onOpenVersions ? [{ label: 'Versions', run: props.onOpenVersions }] : []),
                ...(props.onOpenShare ? [{ label: 'Share', run: props.onOpenShare }] : []),
                { label: 'Export', run: props.onExport, disabled: !props.canExport },
                { label: 'Import', run: props.onImport },
                { label: 'Keyboard shortcuts', run: () => education.open('guide') },
                { label: 'App settings', run: () => education.open('settings') },
                { label: 'Ask the help assistant', run: props.onOpenHelp },
              ]}
            />
          </div>
          <fieldset className="hidden flex-wrap items-center gap-1 md:flex" aria-label="Project commands">
            <ToolbarButton
              type="button"
              variant="ghost"
              onClick={props.onExport}
              disabled={!props.canExport}
              title={props.canExport ? 'Download your work' : 'Select a prompt first.'}
              label="Export"
              icon={<Download className="size-4" />}
            />
            <ToolbarButton
              type="button"
              variant="ghost"
              onClick={props.onImport}
              label="Import"
              icon={<Upload className="size-4" />}
            />
            <ShortcutHelpMenu onAssistant={props.onOpenHelp} />
          </fieldset>
          {props.onOpenShare && (
            <ToolbarButton
              type="button"
              variant="outline"
              className="hidden md:inline-flex"
              onClick={props.onOpenShare}
              label="Share"
              icon={<Share2 className="size-4" />}
            />
          )}
          <ThemeToggle
            className={cn(
              compact,
              'inline-flex items-center justify-center rounded-md hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring',
            )}
          />
        </div>
      </div>
      <div className="studio-document-commands flex flex-wrap items-center justify-between gap-x-4 gap-y-3 border-b border-border px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <ToolbarButton
            type="button"
            variant="outline"
            onClick={props.onBrowsePrompts}
            aria-keyshortcuts="Alt+E"
            aria-label="Toggle prompt explorer"
            aria-expanded={props.explorerOpen}
            aria-controls="prompt-explorer"
            label="Explorer"
            icon={<PanelLeft className="size-4" />}
            shortcut="explorer"
          />
          <h1 className="min-w-0 truncate text-base font-semibold tracking-tight" title={props.selectedRoot?.title}>
            {props.selectedRoot?.title ?? 'No prompt selected'}
          </h1>
          {props.isDirty && (
            <Badge
              variant="outline"
              data-testid="dirty-chip"
              title="Applied changes since the loaded version; local save status is shown above."
              className="shrink-0 text-[10px] text-muted-foreground"
            >
              Modified
            </Badge>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonGroup aria-label="Prompt workspace views" className="studio-view-tabs">
            {(['write', 'graph'] as const).map((view) => (
              <ToolbarButton
                key={view}
                aria-keyshortcuts={view === 'write' ? 'Alt+1' : 'Alt+2 Alt+R'}
                type="button"
                variant={props.view === view && !props.activePanel ? 'secondary' : 'ghost'}
                disabled={!props.selectedRoot}
                aria-pressed={props.view === view && !props.activePanel}
                onClick={() => props.onViewChange?.(view)}
                label={view === 'write' ? 'Write' : 'Graph'}
                icon={<WorkspaceGlyph view={view} />}
                shortcut={view}
              />
            ))}
            <ToolbarButton
              type="button"
              variant={props.activePanel === 'design' ? 'secondary' : 'ghost'}
              onClick={props.onOpenDesign}
              disabled={!props.canOpenDesign}
              aria-keyshortcuts="Alt+3"
              aria-pressed={props.activePanel === 'design'}
              className="hidden md:inline-flex"
              label="Design"
              icon={<Workflow className="size-4" />}
              shortcut="design"
            />
          </ButtonGroup>
          {props.onOpenRun && (
            <ToolbarButton
              type="button"
              variant={props.activePanel === 'run' ? 'secondary' : 'outline'}
              aria-keyshortcuts="Alt+4"
              aria-pressed={props.activePanel === 'run'}
              onClick={props.onOpenRun}
              label="Run"
              icon={<Play className="size-4" />}
              shortcut="run"
            />
          )}
          {props.onOpenEvaluations && (
            <ToolbarButton
              type="button"
              variant={props.activePanel === 'evaluate' ? 'secondary' : 'ghost'}
              aria-keyshortcuts="Alt+5"
              aria-pressed={props.activePanel === 'evaluate'}
              onClick={props.onOpenEvaluations}
              label="Evaluations"
              icon={<FlaskConical className="size-4" />}
              shortcut="evaluations"
            />
          )}
          {props.onAdaptDocument && (
            <ToolbarButton
              type="button"
              variant="ghost"
              onClick={props.onAdaptDocument}
              className="hidden md:inline-flex"
              label="Adapt document"
              icon={<FilePenLine className="size-4" />}
            />
          )}
          <div className="hidden flex-wrap items-center gap-2 md:flex">
            <ButtonGroup aria-label="Review prompt">
              <ToolbarButton
                type="button"
                variant="ghost"
                aria-keyshortcuts="Alt+V"
                aria-pressed={props.activePanel === 'verify'}
                onClick={props.onVerify}
                disabled={props.verifyDisabledReason !== undefined}
                title={props.verifyDisabledReason ?? 'Verify prompt (Alt+V)'}
                label="Verify"
                icon={<ShieldCheck className="size-4" />}
                shortcut="verify"
              />
              <ToolbarButton
                type="button"
                variant="ghost"
                onClick={props.onOpenFinalPrompt}
                disabled={!props.canOpenFinalPrompt}
                label="Final prompt"
                icon={<FileCheck className="size-4" />}
              />
              <ToolbarButton
                type="button"
                variant="ghost"
                onClick={props.onOpenHistory}
                disabled={props.historyDisabledReason !== undefined}
                title={props.historyDisabledReason}
                label="History"
                icon={<History className="size-4" />}
              />
            </ButtonGroup>
            <ButtonGroup aria-label="Shared definitions">
              <ToolbarButton
                type="button"
                variant="ghost"
                onClick={props.onOpenVariables}
                label="Variables"
                icon={<Braces className="size-4" />}
              />
              <ToolbarButton
                type="button"
                variant="ghost"
                onClick={props.onOpenTools}
                label="Tools"
                icon={<Wrench className="size-4" />}
              />
            </ButtonGroup>
            <ToolbarButton
              type="button"
              variant="ghost"
              onClick={props.onUndo}
              disabled={!props.canUndo}
              label="Undo"
              icon={<Undo2 className="size-4" />}
            />
          </div>
          <div className="md:hidden">
            <StudioCommandMenu
              label="More tools"
              icon={<Ellipsis className="size-4" />}
              commands={[
                { label: 'Design', run: props.onOpenDesign, disabled: !props.canOpenDesign, shortcut: 'design' },
                ...(props.onAdaptDocument ? [{ label: 'Adapt document', run: props.onAdaptDocument }] : []),
                {
                  label: 'Verify',
                  shortcut: 'verify',
                  run: props.onVerify,
                  disabled: props.verifyDisabledReason !== undefined,
                  reason: props.verifyDisabledReason,
                },
                { label: 'Final prompt', run: props.onOpenFinalPrompt, disabled: !props.canOpenFinalPrompt },
                {
                  label: 'History',
                  run: props.onOpenHistory,
                  disabled: props.historyDisabledReason !== undefined,
                  reason: props.historyDisabledReason,
                },
                { label: 'Variables', run: props.onOpenVariables },
                { label: 'Tools', run: props.onOpenTools },
                { label: 'Undo', run: props.onUndo, disabled: !props.canUndo },
              ]}
            />
          </div>
        </div>
      </div>
    </header>
  );
}

function WorkspaceGlyph({ view }: { view: 'write' | 'graph' | 'design' }) {
  return (
    <svg
      aria-hidden="true"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.6"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {view === 'write' ? (
        <path d="M14 3H5v18h14v-9M10 14l1-4 8-8 3 3-8 8-4 1Z" />
      ) : view === 'graph' ? (
        <>
          <rect x="2" y="3" width="6" height="6" rx="1.5" />
          <rect x="16" y="15" width="6" height="6" rx="1.5" />
          <path d="M8 6h7a4 4 0 0 1 4 4v5M5 9v9h11" />
        </>
      ) : (
        <>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 9h18M9 9v12M6 6h.01" />
        </>
      )}
    </svg>
  );
}
