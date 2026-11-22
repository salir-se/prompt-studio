import { Button } from '@prompt-studio/ui/button';
import { Input } from '@prompt-studio/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@prompt-studio/ui/tabs';
import { useEffect, useState } from 'react';
import { CloseButton } from '../components/CloseButton';
import type { WorkspaceProjectController } from '../hooks/use-workspace-project';
import { GithubConnection } from './GithubConnection';
import { ProjectArchivePreview } from './ProjectArchivePreview';
import { CurrentProjectSummary, ProjectWelcome } from './ProjectIdentity';
import { ProjectRecovery } from './ProjectRecovery';
import { downloadProjectJson } from './project-download';
import { listPromptVersions, type ProjectArchive, studioJson } from './prompt-repo-client';

export type ProjectSection = 'project' | 'versions' | 'share';

export interface PromptRepoPanelProps {
  readonly section?: ProjectSection;
  readonly onSectionChange?: (section: ProjectSection) => void;
  readonly onSaveVersion?: () => void;
  readonly onClose: () => void;
  readonly presentation?: 'welcome' | 'drawer';
  readonly workspace?: WorkspaceProjectController;
}
const field = 'w-full rounded border border-input bg-background px-3 py-2 text-sm';
const button = 'rounded border border-input px-3 py-2 text-sm disabled:opacity-50';

export { downloadProjectJson } from './project-download';

/** Project actions share the editor's durable draft owner. There is no second text editor. */
export function PromptRepoPanel({
  onClose,
  workspace,
  presentation = 'drawer',
  section,
  onSectionChange,
  onSaveVersion,
}: PromptRepoPanelProps): React.JSX.Element {
  const [tab, setTab] = useState<ProjectSection>('project');
  const [location, setLocation] = useState('');
  const [sourceBranch, setSourceBranch] = useState('');
  const [name, setName] = useState('My prompts');
  const [message, setMessage] = useState('Update prompts');
  const [branch, setBranch] = useState('prompt-studio/changes');
  const [title, setTitle] = useState('Update prompts');
  const [remote, setRemote] = useState('');
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [working, setBusy] = useState(false);
  const busy = working || workspace?.busy === true;
  const [pr, setPr] = useState('');
  const [historyPath, setHistoryPath] = useState('');
  const [versions, setVersions] = useState<readonly { commit: string; message: string }[]>([]);
  const [imported, setImported] = useState<ProjectArchive | null>(null);
  const [recent, setRecent] = useState<readonly { projectId: string; name: string }[]>([]);
  useEffect(() => {
    if (!workspace?.enabled) return;
    studioJson<{ projects?: readonly { projectId: string; name: string }[] }>('/__studio/prompt-repo/recent')
      .then((result) => setRecent(result.projects ?? []))
      .catch(() => undefined);
  }, [workspace?.enabled]);
  const projectId = workspace?.project?.projectId;
  const revision = workspace?.project?.revision;
  useEffect(() => {
    if (projectId) setHistoryPath('');
  }, [projectId]);
  useEffect(() => {
    setVersions([]);
    if (!projectId || revision === undefined || !historyPath) return;
    let cancelled = false;
    listPromptVersions({ projectId, revision }, historyPath)
      .then((result) => {
        if (!cancelled) setVersions(result.versions);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => {
      cancelled = true;
    };
  }, [historyPath, projectId, revision]);
  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError('');
    setNotice('');
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }
  async function inspectImport(file: File): Promise<void> {
    if (file.size > 64 * 1024 * 1024) throw new Error('Project file is too large (maximum 64 MB).');
    const value = JSON.parse(await file.text()) as ProjectArchive;
    if (
      !value ||
      typeof value !== 'object' ||
      value.format !== 'prompt-studio-project-files@1' ||
      !Array.isArray(value.files) ||
      typeof value.name !== 'string' ||
      value.files.some((file) => !file || typeof file.path !== 'string' || typeof file.base64 !== 'string')
    )
      throw new Error('Choose an exported Prompt Studio project JSON file.');
    setImported(value);
  }
  return (
    <section
      aria-label="Your prompts"
      className={
        presentation === 'welcome'
          ? 'studio mx-auto flex min-h-dvh max-w-5xl flex-col gap-6 px-6 py-12'
          : 'studio fixed inset-y-0 right-0 z-40 flex w-[32rem] max-w-full flex-col gap-4 overflow-x-hidden overflow-y-auto border-l border-border bg-card p-4 shadow-xl'
      }
    >
      {presentation === 'welcome' && <ProjectWelcome />}
      <header className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold tracking-tight">
          {workspace?.project ? `Project · ${workspace.project.name}` : 'Open or create a project'}
        </h2>
        {presentation !== 'welcome' && <CloseButton onClick={onClose} />}
      </header>
      {workspace?.project && (
        <CurrentProjectSummary project={workspace.project} pending={workspace.pending} error={workspace.error} />
      )}
      {(workspace?.pending ?? 0) > 0 && <p role="status">Saving changes…</p>}
      <ProjectRecovery workspace={workspace} error={error} busy={busy} run={run} />
      {!workspace?.enabled ? (
        <p>Project repositories are available in the standalone Prompt Studio application.</p>
      ) : (
        <Tabs value={section ?? tab} onValueChange={(value) => (onSectionChange ?? setTab)(value as ProjectSection)}>
          <TabsList aria-label="Project sections" className={workspace.project ? undefined : 'hidden'}>
            <TabsTrigger value="project">Project</TabsTrigger>
            {workspace.project && (
              <>
                <TabsTrigger value="versions">Versions</TabsTrigger>
                <TabsTrigger value="share">Share</TabsTrigger>
              </>
            )}
          </TabsList>
          <TabsContent value="project" className="space-y-5" aria-label="Open or create project">
            {recent.length > 0 && (
              <div>
                <h3 className="font-medium">Recent projects</h3>
                {recent.map((item) => (
                  <Button
                    variant="outline"
                    className={`${button} h-auto w-full justify-start gap-3 text-left`}
                    type="button"
                    key={item.projectId}
                    disabled={busy}
                    onClick={() => void run(() => workspace.switchProject('resume', { projectId: item.projectId }))}
                  >
                    <span className="min-w-0 flex-1 truncate">{item.name}</span>
                    <span className="max-w-36 truncate font-mono text-xs text-muted-foreground">{item.projectId}</span>
                  </Button>
                ))}
              </div>
            )}
            <div className={presentation === 'welcome' ? 'grid items-start gap-5 md:grid-cols-2' : 'grid gap-5'}>
              <form
                aria-label="Create a project"
                className="grid gap-3 rounded-xl border border-border bg-background p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await workspace.switchProject('new', { name });
                    setNotice('Project created. Close this panel to create your first prompt.');
                  });
                }}
              >
                <div>
                  <h3 className="text-base font-semibold">Start fresh</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Keep a collection of prompts and their definitions together.
                  </p>
                </div>
                <label htmlFor="project-name">
                  Project name
                  <Input
                    id="project-name"
                    className={field}
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    required
                  />
                </label>
                <Button variant="outline" className={button} disabled={busy} type="submit">
                  Create project
                </Button>
              </form>
              <form
                aria-label="Open an existing project"
                className="grid gap-3 rounded-xl border border-border bg-background p-4"
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(async () => {
                    await workspace.switchProject('open', {
                      ...(/^https:\/\//i.test(location) ? { url: location } : { path: location }),
                      ...(sourceBranch.trim() ? { branch: sourceBranch.trim() } : {}),
                    });
                    setNotice('Project opened.');
                  });
                }}
              >
                <div>
                  <h3 className="text-base font-semibold">Bring a project</h3>
                  <p className="mt-1 text-xs leading-5 text-muted-foreground">
                    Open a repository from this computer or GitHub.
                  </p>
                </div>
                <label htmlFor="project-location">
                  Repository URL or filesystem path
                  <Input
                    id="project-location"
                    className={field}
                    placeholder="https://github.com/team/prompts or /path/to/repository"
                    value={location}
                    onChange={(event) => setLocation(event.target.value)}
                    required
                  />
                </label>
                <label htmlFor="source-branch">
                  Source branch (optional)
                  <Input
                    id="source-branch"
                    className={field}
                    value={sourceBranch}
                    onChange={(event) => setSourceBranch(event.target.value)}
                    placeholder="Use the default branch"
                  />
                </label>
                <Button variant="outline" className={button} disabled={busy} type="submit">
                  Open project
                </Button>
              </form>
            </div>
            <details>
              <summary className="cursor-pointer text-sm font-medium">GitHub access for private repositories</summary>
              <div className="pt-3">
                <GithubConnection />
              </div>
            </details>
            <label htmlFor="project-import" className="grid gap-2">
              Import project archive (JSON)
              <Input
                id="project-import"
                type="file"
                accept=".json,application/json"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) void run(() => inspectImport(file));
                }}
              />
            </label>
            {imported && (
              <ProjectArchivePreview
                archive={imported}
                busy={busy}
                onCancel={() => setImported(null)}
                onImport={() =>
                  void run(async () => {
                    await workspace.switchProject('import', imported);
                    setImported(null);
                    setNotice('Imported project.');
                  })
                }
              />
            )}
          </TabsContent>
          {workspace.project && (
            <>
              <TabsContent value="versions" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Save a named checkpoint of this project. Applied edits are already saved locally; a version makes a
                  point you can return to. A checkpoint covers the project; restoring below changes one selected prompt.
                </p>
                <form
                  className="grid gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(async () => {
                      await workspace.save(message);
                      onSaveVersion?.();
                      setNotice('Saved a version of your project.');
                    });
                  }}
                >
                  <label htmlFor="version-message">
                    Version message
                    <Input
                      id="version-message"
                      className={field}
                      value={message}
                      onChange={(event) => setMessage(event.target.value)}
                      required
                    />
                  </label>
                  <Button variant="outline" className={button} disabled={busy} type="submit">
                    Save version
                  </Button>
                </form>
                <details>
                  <summary className="cursor-pointer font-medium">Saved versions</summary>
                  <h3 className="mt-4 text-sm font-semibold">Restore a prompt from a checkpoint</h3>
                  <p className="my-2 text-xs leading-5 text-muted-foreground">
                    Choose the prompt to replace. Other prompts stay as they are; restoration creates a new commit.
                    Evaluation Git tags are created separately in Compare.
                  </p>
                  <label>
                    Prompt
                    <select
                      className={field}
                      value={historyPath}
                      onChange={(event) => setHistoryPath(event.target.value)}
                    >
                      <option value="">Choose a prompt</option>
                      {workspace.project.documents.map((document) => (
                        <option key={document.path} value={document.path}>
                          {document.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  {versions.map((version) => (
                    <div key={version.commit} className="my-2 flex flex-wrap items-center gap-2">
                      <span>
                        {version.message} ({version.commit.slice(0, 7)})
                      </span>
                      <Button
                        variant="outline"
                        className={button}
                        type="button"
                        disabled={busy}
                        onClick={() =>
                          void run(async () => {
                            await workspace.restore(historyPath, version.commit);
                            setNotice(
                              `Restored ${workspace.project?.documents.find((document) => document.path === historyPath)?.title ?? historyPath} from the selected checkpoint.`,
                            );
                          })
                        }
                      >
                        Restore this version
                      </Button>
                    </div>
                  ))}
                </details>
              </TabsContent>
              <TabsContent value="share" className="space-y-4">
                <p className="text-sm text-muted-foreground">
                  Connect GitHub and publish a new branch for review. Local saving never shares your work.
                </p>
                <GithubConnection />
                <details open>
                  <summary className="cursor-pointer font-medium">Publish a branch and open a pull request</summary>
                  <form
                    className="mt-3 grid gap-2"
                    onSubmit={(event) => {
                      event.preventDefault();
                      void run(async () => {
                        const result = await workspace.publish({
                          branch,
                          title,
                          ...(remote.trim() ? { url: remote.trim() } : {}),
                        });
                        setPr(result.url);
                        setNotice('Pull request opened.');
                      });
                    }}
                  >
                    {!workspace.project.remote && (
                      <label htmlFor="publish-url">
                        GitHub repository URL
                        <Input
                          id="publish-url"
                          className={field}
                          type="url"
                          value={remote}
                          onChange={(event) => setRemote(event.target.value)}
                          required
                        />
                      </label>
                    )}
                    <label htmlFor="publish-branch">
                      New branch
                      <Input
                        id="publish-branch"
                        className={field}
                        value={branch}
                        onChange={(event) => setBranch(event.target.value)}
                        required
                      />
                    </label>
                    <label htmlFor="publish-title">
                      Pull request title
                      <Input
                        id="publish-title"
                        className={field}
                        value={title}
                        onChange={(event) => setTitle(event.target.value)}
                        required
                      />
                    </label>
                    <div className="rounded-lg border border-border bg-muted/20 p-3 text-xs leading-5">
                      <p className="font-medium">Publication summary</p>
                      <p className="break-all">
                        Repository: {workspace.project.remote ?? (remote || 'Choose a repository')}
                      </p>
                      <p>
                        Base branch: {workspace.project.branch} · New branch: {branch || 'Choose a branch'}
                      </p>
                      <p>
                        Your saved project files will be committed to this branch and shared on GitHub. Local saving
                        alone never publishes.
                      </p>
                    </div>
                    <Button variant="outline" className={button} disabled={busy} type="submit">
                      Publish branch and open PR
                    </Button>
                  </form>
                </details>
              </TabsContent>
              <Button
                variant="outline"
                type="button"
                className={button}
                disabled={busy}
                onClick={() =>
                  void run(async () =>
                    downloadProjectJson(await workspace.exportProject(), 'prompt-studio-project.json'),
                  )
                }
              >
                Export project
              </Button>
            </>
          )}
        </Tabs>
      )}
      {notice && <p role="status">{notice}</p>}
      {pr && (
        <a href={pr} target="_blank" rel="noreferrer" className="underline">
          Open pull request
        </a>
      )}
    </section>
  );
}
