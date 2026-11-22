import { FocusScope } from '@radix-ui/react-focus-scope';
import { PromptGraphCanvas, type PromptGraphCanvasProps } from '@prompt-studio/prompt-graph-ui';
import type { PromptGraphNode } from '@prompt-studio/prompts';
import { Button } from '@prompt-studio/ui/button';
import type { ReactNode } from 'react';
import type { CatalogRoot } from '../catalog/root-catalog';
import { useMediaQuery } from '../hooks/use-media-query';
import { Inspector } from './Inspector';

export function GraphWorkspace({
  selectedNode,
  selectedRoot,
  onDesignSection,
  fileEditor,
  fileDetails,
  onCloseInspector,
  inspectorHidden,
  ...canvas
}: PromptGraphCanvasProps & {
  fileEditor?: ReactNode;
  fileDetails?: ReactNode;
  selectedNode?: PromptGraphNode;
  selectedRoot?: CatalogRoot;
  onDesignSection?: (nodeId: string) => void;
  onCloseInspector?: () => void;
  inspectorHidden?: boolean;
}) {
  const narrow = useMediaQuery('(max-width: 767px)');
  const detailsOpen = !inspectorHidden && !!(selectedNode || fileEditor);
  const modalProps = narrow ? { role: 'dialog' as const, 'aria-modal': true as const } : {};
  function closeInspector() {
    onCloseInspector?.();
    const id = selectedNode?.id;
    if (id)
      requestAnimationFrame(() =>
        document.querySelector<HTMLElement>(`.react-flow__node[data-id="${CSS.escape(id)}"]`)?.focus(),
      );
  }
  return (
    <div className="relative flex h-full min-h-0 min-w-0">
      <div className="studio-graph-area relative min-w-0 flex-1" inert={narrow && detailsOpen}>
        {canvas.model.nodes.length > 0 && (
          <p className="studio-graph-help pointer-events-none absolute top-3 left-3 z-10 max-w-[calc(100%-1.5rem)] rounded-md border border-border bg-card px-3 py-2 text-xs text-muted-foreground">
            Drag a node header to arrange. Select to inspect.{' '}
            <span className="hidden md:inline">Arrow keys move a selected node.</span>
          </p>
        )}
        <PromptGraphCanvas {...canvas} />
      </div>
      {detailsOpen && (
        <FocusScope
          asChild
          trapped={narrow}
          loop={narrow}
          onMountAutoFocus={(event) => {
            if (!narrow) event.preventDefault();
          }}
          onUnmountAutoFocus={(event) => event.preventDefault()}
        >
          <aside
            {...modalProps}
            aria-label="Graph details"
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || event.defaultPrevented || fileEditor || !onCloseInspector) return;
              if (
                event.target instanceof Element &&
                event.target.closest('[role="menu"], [data-slot="dialog-content"]')
              )
                return;
              event.preventDefault();
              event.stopPropagation();
              closeInspector();
            }}
            className="absolute inset-y-0 right-0 z-10 w-[min(420px,100%)] shrink-0 overflow-x-hidden overflow-y-auto border-l border-border bg-card shadow-lg xl:static xl:shadow-none"
            data-testid="prompt-studio-inspector"
          >
            {!fileEditor && onCloseInspector && (
              <header className="sticky top-0 z-10 border-b border-border bg-card p-2">
                <Button type="button" variant="ghost" size="sm" onClick={closeInspector}>
                  Back to graph
                </Button>
              </header>
            )}
            {fileEditor ?? (
              <>
                <Inspector
                  node={selectedNode}
                  model={canvas.model}
                  selectedRoot={selectedRoot}
                  onEditSection={(id) => canvas.onEditNode?.(id)}
                  onDesignSection={onDesignSection}
                />
                {fileDetails}
              </>
            )}
          </aside>
        </FocusScope>
      )}
    </div>
  );
}
