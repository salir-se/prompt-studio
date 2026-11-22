/**
 * The canvas inspector (ADR-200/ADR-202): the selected graph node's detail pane — a section's
 * delimiter/depth/range/body plus its Edit button, a variable/tool node's referencing sections,
 * or the root node's status/owner plus the whole-document markdown editor entry. Pure and
 * prop-driven: App.tsx owns the model and the edit-dialog state.
 */

import type { PromptGraphModel, PromptGraphNode } from '@prompt-studio/prompts';
import type { CatalogRoot } from '../catalog/root-catalog';
import {
  BADGE_OUTLINE_CLASSES,
  BUTTON_BASE_CLASSES,
  BUTTON_DEFAULT_CLASSES,
  BUTTON_SM_CLASSES,
  cn,
} from './ui-classes';

function ChipRow({ label, values }: { label: string; values: readonly string[] }): React.JSX.Element | null {
  if (values.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-xs text-muted-foreground">{label}</span>
      <ul className="flex min-w-0 max-w-full flex-wrap gap-1" aria-label={label}>
        {values.map((value) => (
          <li
            key={value}
            className="inline-flex min-w-0 max-w-full items-center rounded-sm bg-muted px-1.5 py-0.5 font-mono text-xs text-foreground [overflow-wrap:anywhere]"
          >
            {value}
          </li>
        ))}
      </ul>
    </div>
  );
}

export interface InspectorProps {
  node: PromptGraphNode | undefined;
  model: PromptGraphModel;
  selectedRoot: CatalogRoot | undefined;
  onEditSection: (nodeId: string) => void;
  onDesignSection?: (nodeId: string) => void;
}

export function Inspector({
  node,
  model,
  selectedRoot,
  onEditSection,
  onDesignSection,
}: InspectorProps): React.JSX.Element | null {
  if (!node) return null;

  const kindBadge = <span className={cn(BADGE_OUTLINE_CLASSES, 'font-mono uppercase')}>{node.kind}</span>;

  if (node.data.kind === 'section') {
    const section = node.data.node;
    return (
      <div className="flex min-w-0 flex-col gap-4 p-5 [overflow-wrap:anywhere]">
        {kindBadge}
        <h2 className="text-xl font-semibold tracking-tight">{section.title}</h2>

        <ChipRow label="Variables" values={section.variables} />
        <ChipRow label="Tools" values={section.toolMentions} />
        <div className="flex min-h-0 flex-col gap-1">
          <span className="text-xs text-muted-foreground">Body</span>
          <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-muted p-2 font-mono text-xs">
            {section.text}
          </pre>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={cn(BUTTON_BASE_CLASSES, BUTTON_SM_CLASSES, BUTTON_DEFAULT_CLASSES, 'w-fit')}
            onClick={() => onEditSection(node.id)}
          >
            Edit section
          </button>
          {onDesignSection && (
            <button
              type="button"
              className={cn(BUTTON_BASE_CLASSES, BUTTON_SM_CLASSES, BUTTON_DEFAULT_CLASSES, 'w-fit')}
              onClick={() => onDesignSection(node.id)}
            >
              Design sub-prompt
            </button>
          )}
        </div>
        <details className="rounded-lg border p-3 text-xs text-muted-foreground">
          <summary className="cursor-pointer">Source details</summary>
          <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <dt>Delimiter</dt>
            <dd className="font-mono text-foreground">{section.delimiter}</dd>
            <dt>Depth</dt>
            <dd className="text-foreground">{section.depth}</dd>
            <dt>Range</dt>
            <dd className="font-mono text-foreground">
              {section.range.start}–{section.range.end}
            </dd>
          </dl>
        </details>
      </div>
    );
  }

  if (node.data.kind === 'variable' || node.data.kind === 'tool' || node.data.kind === 'file') {
    const referencingSections = model.edges
      .filter((edge) => edge.kind !== 'contains' && edge.target === node.id)
      .map((edge) => model.nodes.find((candidate) => candidate.id === edge.source))
      .filter((candidate): candidate is PromptGraphNode => candidate !== undefined);

    return (
      <div className="flex min-w-0 flex-col gap-4 p-5 [overflow-wrap:anywhere]">
        {kindBadge}
        <h2 className="break-all font-mono text-sm font-semibold">{node.label}</h2>
        {node.data.kind === 'file' && (
          <p className="text-xs text-muted-foreground">
            {node.data.loadBeforeBody ? 'Load before prompt body (@ reference).' : 'Referenced file.'} Loading is
            performed by the host running this prompt.
          </p>
        )}
        <div className="flex flex-col gap-1">
          <span className="text-xs text-muted-foreground">Referenced by</span>
          {referencingSections.length === 0 ? (
            <p className="text-xs text-muted-foreground">No sections reference this {node.data.kind}.</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {referencingSections.map((section) => (
                <li key={section.id} className="rounded-md bg-muted px-2 py-1 text-xs">
                  {section.label}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  }

  // node.data.kind === 'root'
  if (!selectedRoot) return null;
  return (
    <div className="flex min-w-0 flex-col gap-4 p-5 [overflow-wrap:anywhere]">
      {kindBadge}
      <h2 className="text-sm font-semibold">{selectedRoot.title}</h2>
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <dt>Status</dt>
        <dd className="capitalize text-foreground">{selectedRoot.status}</dd>
        <dt>Owner</dt>
        <dd className="font-mono text-foreground">{selectedRoot.ownerLabel}</dd>
      </dl>
      <ChipRow label="Tools" values={selectedRoot.toolNames} />
      <ChipRow label="Protected skills" values={selectedRoot.protectedSkills} />
      {/* The root IS the markdown source the sections are extracted from (ADR-202 §3) — this
          opens the whole document in the same highlighted editor a section edit uses. Also
          reachable by double-clicking the root chip on the canvas. */}
      <button
        type="button"
        className={cn(BUTTON_BASE_CLASSES, BUTTON_SM_CLASSES, BUTTON_DEFAULT_CLASSES, 'w-fit')}
        onClick={() => onEditSection(node.id)}
      >
        Edit markdown
      </button>
    </div>
  );
}
