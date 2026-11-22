import type { ComponentProps } from 'react';
import { useMemo } from 'react';
import { GraphWorkspace } from '../components/GraphWorkspace';
import type { WorkspaceProject } from '../prompt-repo/prompt-repo-client';
import { resolveProjectReference } from '../references-resolver';
import { FileReferenceDetails } from './FileReferenceDetails';
import { ReferencedFileEditor } from './ReferencedFileEditor';
import type { ProjectFileEditor } from './use-project-file-editor';

export function ProjectGraphWorkspace({
  project,
  fileEditor,
  ...props
}: Omit<ComponentProps<typeof GraphWorkspace>, 'fileEditor' | 'fileDetails'> & {
  project: WorkspaceProject | null;
  fileEditor: ProjectFileEditor;
}) {
  const files = project?.files;
  const sourcePath = project?.documents.find((file) => file.id === props.selectedRoot?.id)?.path ?? '';
  const resolutions = useMemo(
    () =>
      new Map(
        props.model.nodes.flatMap((node) =>
          node.data.kind === 'file'
            ? [[node.id, resolveProjectReference(node.data.path, sourcePath, files ?? [])] as const]
            : [],
        ),
      ),
    [props.model, files, sourcePath],
  );
  const model = useMemo(
    () => ({
      ...props.model,
      nodes: props.model.nodes.map((node) =>
        resolutions.has(node.id) ? { ...node, label: `${resolutions.get(node.id)?.state}: ${node.label}` } : node,
      ),
    }),
    [props.model, resolutions],
  );
  const selected = resolutions.get(props.selectedNode?.id ?? '');
  function openFile(path: string, nodeId = props.selectedNode?.id ?? '') {
    return fileEditor.open(path, document.querySelector<HTMLElement>(`[data-id="${CSS.escape(nodeId)}"]`));
  }
  return (
    <GraphWorkspace
      {...props}
      model={model}
      fileEditor={fileEditor.active ? <ReferencedFileEditor editor={fileEditor} /> : undefined}
      fileDetails={selected ? <FileReferenceDetails resolution={selected} onOpen={openFile} /> : undefined}
      onEditNode={(id) => {
        const file = resolutions.get(id);
        if (file?.state === 'Found') void openFile(file.path, id);
        else props.onEditNode?.(id);
      }}
    />
  );
}
