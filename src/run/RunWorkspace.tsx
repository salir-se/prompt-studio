import { Button } from '@prompt-studio/ui/button';
import { Maximize2, Minimize2, Minus } from '@prompt-studio/ui/icons';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@prompt-studio/ui/tabs';
import { TimelineScrollRegion } from '@prompt-studio/ui/timeline-scroll-region';
import { cn } from '@prompt-studio/ui/utils';
import { useEffect, useRef, useState } from 'react';
import { CloseButton } from '../components/CloseButton';
import type { WorkspaceProject } from '../prompt-repo/prompt-repo-client';
import { ToolbarButton } from '../shortcuts/ToolbarButton';
import { useShortcutEducation } from '../shortcuts/shortcut-context';
import { EvaluationWorkspace } from './EvaluationWorkspace';
import { PROVIDER_LABELS } from './RunFields';
import { RunSetupFields } from './RunSetupFields';
import { SingleRun } from './SingleRun';
import { useEvaluationSession } from './use-evaluation-session';
import { useRunSession } from './use-run-session';

export interface RunWorkspaceProps {
  project: Pick<WorkspaceProject, 'projectId' | 'revision'>;
  promptPath: string;
  source: string;
  draft: boolean;
  projectPending?: boolean;
  onClose: () => void;
  onDirtyChange?: (dirty: boolean) => void;
  dock?: boolean;
  hidden?: boolean;
  initialTab?: 'single' | 'suites' | 'compare' | 'settings';
  onOpenEvaluations?: () => void;
}

export function RunWorkspace({
  project,
  promptPath,
  source,
  draft,
  projectPending,
  onClose,
  onDirtyChange,
  dock = false,
  hidden = false,
  initialTab,
  onOpenEvaluations,
}: RunWorkspaceProps) {
  const education = useShortcutEducation();
  const openSettings = () => education.open('settings', 'execution');
  const showEvaluations = dock || !onOpenEvaluations;
  const [tab, setTab] = useState<string>(
    dock
      ? initialTab && initialTab !== 'single'
        ? initialTab
        : 'suites'
      : showEvaluations
        ? (initialTab ?? 'single')
        : initialTab === 'settings'
          ? 'settings'
          : 'single',
  );
  const [expanded, setExpanded] = useState(false);
  const [minimized, setMinimized] = useState(false);
  const [comparisonDirty, setComparisonDirty] = useState(false);
  const scope = { projectId: project.projectId, revision: project.revision, promptPath, source, projectPending };
  const run = useRunSession(scope);
  const evaluation = useEvaluationSession(scope);
  const dirty = run.dirty || evaluation.dirty || comparisonDirty;
  const errorMessage =
    tab === 'suites' || tab === 'compare' ? evaluation.error || run.error : run.error || evaluation.error;
  const errorNotice = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!errorMessage) return;
    errorNotice.current?.focus();
    errorNotice.current?.scrollIntoView({ block: 'nearest' });
  }, [errorMessage]);
  useEffect(() => {
    onDirtyChange?.(dirty);
  }, [dirty, onDirtyChange]);
  return (
    <aside
      hidden={hidden}
      aria-label={dock ? 'Evaluations' : 'Run and evaluate prompt'}
      data-evaluation-dock={dock || undefined}
      className={cn(
        'min-h-0 w-full flex-col border-border bg-background shadow-xl',
        hidden ? 'hidden' : 'flex',
        dock
          ? 'fixed inset-0 z-30 h-dvh max-h-dvh md:relative md:inset-auto md:z-10 md:shrink-0 md:border-t'
          : 'fixed inset-y-0 right-0 z-20 max-w-[1200px] border-l',
        dock &&
          (minimized
            ? 'md:h-auto'
            : expanded
              ? 'md:h-[75dvh]'
              : 'md:h-[35dvh] md:[@media(min-height:900px)]:h-[50dvh]'),
      )}
      onKeyDown={(event) => {
        if (
          (event.ctrlKey || event.metaKey) &&
          event.key === 'Enter' &&
          tab === 'single' &&
          !event.nativeEvent.isComposing &&
          !event.defaultPrevented &&
          !event.altKey &&
          !event.shiftKey
        ) {
          const overlay =
            event.target instanceof Element ? event.target.closest('[role="dialog"], [role="menu"]') : null;
          if (overlay && !overlay.hasAttribute('data-studio-panels')) return;
          event.preventDefault();
          event.stopPropagation();
          void run.run();
        }
      }}
    >
      <header className={cn('flex shrink-0 items-start justify-between gap-3 border-b sm:px-6', dock ? 'p-3' : 'p-4')}>
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">{dock ? 'Evaluations' : 'Run & evaluate'}</h2>
          <p className="mt-0.5 truncate font-mono text-xs text-muted-foreground" title={promptPath}>
            {promptPath}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {dock && (
            <>
              {!minimized && (
                <ToolbarButton
                  type="button"
                  variant="ghost"
                  className="hidden md:inline-flex"
                  label={expanded ? 'Restore evaluation height' : 'Expand evaluations'}
                  icon={expanded ? <Minimize2 className="size-4" /> : <Maximize2 className="size-4" />}
                  aria-pressed={expanded}
                  onClick={() => setExpanded(!expanded)}
                />
              )}
              <ToolbarButton
                type="button"
                variant="ghost"
                className="hidden md:inline-flex"
                label={minimized ? 'Restore evaluations' : 'Minimize evaluations'}
                icon={minimized ? <Maximize2 className="size-4" /> : <Minus className="size-4" />}
                aria-expanded={!minimized}
                onClick={() => setMinimized(!minimized)}
              />
            </>
          )}
          {!dock && onOpenEvaluations && (
            <Button type="button" variant="outline" onClick={onOpenEvaluations}>
              Open evaluations
            </Button>
          )}
          <CloseButton onClick={onClose} label={dock ? 'Close evaluations' : 'Close run workspace'} />
        </div>
      </header>
      <div className={cn('flex min-h-0 flex-1 flex-col', dock && minimized && 'md:hidden')}>
        {projectPending && (
          <p role="status" className="border-b bg-muted/40 px-4 py-3 text-sm">
            Wait for project changes to save before running, saving a suite or creating a Git tag. If saving failed,
            close this workspace and choose Retry saving.
          </p>
        )}
        <Tabs value={tab} onValueChange={setTab} className="flex min-h-0 flex-1 flex-col gap-0">
          <div className="shrink-0 overflow-x-auto border-b px-3 py-2 sm:px-5">
            <TabsList variant="pill" className="h-auto min-w-max">
              {!dock && (
                <TabsTrigger className="min-h-10" value="single">
                  Single run
                </TabsTrigger>
              )}
              {showEvaluations && (
                <>
                  <TabsTrigger className="min-h-10" value="suites">
                    Test suites
                  </TabsTrigger>
                  <TabsTrigger className="min-h-10" value="compare">
                    Compare
                  </TabsTrigger>
                </>
              )}
              <TabsTrigger className="min-h-10" value="settings">
                Settings
              </TabsTrigger>
            </TabsList>
          </div>
          <TimelineScrollRegion className="min-h-0 flex-1" viewportClassName="scroll-pb-32">
            {errorMessage && (
              <div
                ref={errorNotice}
                role="alert"
                tabIndex={-1}
                className="m-4 grid gap-2 rounded-lg border border-destructive/50 p-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <p>{errorMessage}</p>
                {(run.loading || !run.settings) && (
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-self-start"
                    onClick={() => void run.load()}
                  >
                    Retry execution setup
                  </Button>
                )}
                {evaluation.error && (
                  <Button
                    type="button"
                    variant="outline"
                    className="justify-self-start"
                    disabled={evaluation.dirty || evaluation.busy || evaluation.loading}
                    onClick={() => void evaluation.load()}
                  >
                    Reload saved evaluations
                  </Button>
                )}
              </div>
            )}
            {(run.pollError || evaluation.pollError) && (
              <p role="status" className="m-4 rounded-lg border p-3 text-xs">
                {run.pollError || evaluation.pollError}
              </p>
            )}
            {run.loading ? (
              <p role="status" className="p-6 text-sm text-muted-foreground">
                Loading run setup and saved results…
              </p>
            ) : (
              <>
                {!dock && (
                  <TabsContent value="single" className="mt-0 min-h-full">
                    <SingleRun session={run} source={source} draft={draft} onSettings={openSettings} />
                  </TabsContent>
                )}
                {showEvaluations && (
                  <>
                    <TabsContent
                      value="suites"
                      forceMount
                      hidden={tab !== 'suites'}
                      className="mt-0 min-h-full data-[state=inactive]:hidden"
                    >
                      {evaluation.loading ? (
                        <p role="status" className="p-6 text-sm">
                          Loading test suites…
                        </p>
                      ) : (
                        <EvaluationWorkspace
                          session={evaluation}
                          mcpServers={run.settings?.mcpServers}
                          setup={run.setup}
                          runSetup={
                            <RunSetupFields
                              setup={run.setup}
                              settings={run.settings}
                              connected={run.connected}
                              onChange={run.setSetup}
                              onSettings={openSettings}
                            />
                          }
                          onBeforeEvaluate={run.saveProfile}
                          source={source}
                          draft={draft}
                          compare={false}
                          connected={run.connected}
                          onDirtyChange={() => {}}
                        />
                      )}
                    </TabsContent>
                    <TabsContent
                      value="compare"
                      forceMount
                      hidden={tab !== 'compare'}
                      className="mt-0 min-h-full data-[state=inactive]:hidden"
                    >
                      {evaluation.loading ? (
                        <p role="status" className="p-6 text-sm">
                          Loading Git versions…
                        </p>
                      ) : (
                        <EvaluationWorkspace
                          session={evaluation}
                          mcpServers={run.settings?.mcpServers}
                          setup={run.setup}
                          runSetup={
                            <RunSetupFields
                              setup={run.setup}
                              settings={run.settings}
                              connected={run.connected}
                              onChange={run.setSetup}
                              onSettings={openSettings}
                            />
                          }
                          onBeforeEvaluate={run.saveProfile}
                          source={source}
                          draft={draft}
                          compare
                          connected={run.connected}
                          onDirtyChange={setComparisonDirty}
                        />
                      )}
                    </TabsContent>
                  </>
                )}
                <TabsContent
                  value="settings"
                  forceMount
                  hidden={tab !== 'settings'}
                  className="mt-0 min-h-full data-[state=inactive]:hidden"
                >
                  {run.settings && (
                    <section className="mx-auto grid w-full max-w-2xl gap-4 p-4 sm:p-6">
                      <div>
                        <h3 className="font-semibold">Shared execution settings</h3>
                        <p className="mt-1 text-sm text-muted-foreground">
                          Configure the provider, model and skills folder once in app settings. All prompt runs and
                          evaluations inherit them.
                        </p>
                      </div>
                      <dl className="grid min-w-0 gap-3 rounded-lg border p-4 text-sm">
                        <div>
                          <dt className="text-xs text-muted-foreground">Provider / model</dt>
                          <dd className="break-words">
                            {PROVIDER_LABELS[run.setup.provider]} · {run.setup.model || 'No model configured'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Skills folder</dt>
                          <dd className="break-all font-mono">{run.settings.skillsFolder || 'No folder configured'}</dd>
                        </div>
                      </dl>
                      <Button type="button" variant="outline" className="justify-self-start" onClick={openSettings}>
                        Open app settings
                      </Button>
                    </section>
                  )}
                </TabsContent>
              </>
            )}
          </TimelineScrollRegion>
        </Tabs>
        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t bg-muted/20 px-4 py-2 text-xs text-muted-foreground sm:px-6">
          <span>{dirty ? 'Unsaved setup changes' : 'Outputs and results are saved locally'}</span>
          <span>
            {run.running || evaluation.running
              ? 'A run is active · close and return at any time'
              : dock
                ? 'Ctrl/Cmd+Enter · Run tests'
                : 'Alt+4 · Run workspace'}
          </span>
        </footer>
      </div>
    </aside>
  );
}
