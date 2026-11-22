import { type AppProps, StudioEditor } from './StudioEditor';
import { useWorkspaceProject } from './hooks/use-workspace-project';
import { PromptRepoPanel } from './prompt-repo/PromptRepoPanel';
import { ShortcutEducation } from './shortcuts/ShortcutEducation';

export { unreadableReason } from './components/Sidebar';
export { spliceSectionBody } from './hooks/use-document-editor';
export {
  filterDeclaredKnownPlaceholderFindings,
  resolveSessionSamplesForPreview,
} from './hooks/use-variables-registry';
export type { AppProps } from './StudioEditor';

export function App(props: AppProps = {}): React.JSX.Element {
  return (
    <ShortcutEducation>
      <StudioWorkspace {...props} />
    </ShortcutEducation>
  );
}

function StudioWorkspace(props: AppProps): React.JSX.Element {
  const workspace = useWorkspaceProject();
  if (workspace.loading) return <p role="status">Opening your project…</p>;
  if (workspace.enabled && !workspace.project)
    return <PromptRepoPanel workspace={workspace} presentation="welcome" onClose={() => undefined} />;
  return (
    <div className="studio" inert={workspace.busy}>
      <StudioEditor
        key={`${workspace.project?.projectId ?? 'developer'}:${workspace.generation}`}
        {...props}
        workspace={workspace}
      />
      {workspace.busy && <p role="status">Updating project…</p>}
    </div>
  );
}
