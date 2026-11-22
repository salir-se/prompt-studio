import { ProjectPicker } from './ProjectPicker';
import type { HistoryState } from './hooks/use-history-boot';
import type { ProjectActions } from './hooks/use-project-actions';
import type { StudioManifestBaseline } from './manifest/manifest-schema';

export function DeveloperProjectPicker({
  history,
  baselines,
  actions,
  canChange,
}: {
  history: HistoryState | null;
  baselines: readonly StudioManifestBaseline[];
  actions: ProjectActions;
  canChange: () => boolean;
}) {
  if (!history) return null;
  return (
    <ProjectPicker
      projects={history.projects}
      activeId={history.activeProjectId}
      baselines={baselines.map(({ id, label, description, positioning }) => ({
        id,
        label,
        description,
        positioning: positioning ?? 'shipped',
      }))}
      onSwitch={(id) => {
        if (canChange()) actions.switchProject(id);
      }}
      onCreate={(name, baseline) => {
        if (canChange()) actions.createProject(name, baseline);
      }}
      onRename={actions.renameProject}
      onDuplicate={(id, name) => {
        if (canChange()) actions.duplicateProject(id, name);
      }}
      onDelete={(id) => {
        if (canChange()) actions.deleteProject(id);
      }}
      onReset={(id) => {
        if (canChange()) actions.resetConfiguration(id);
      }}
    />
  );
}
