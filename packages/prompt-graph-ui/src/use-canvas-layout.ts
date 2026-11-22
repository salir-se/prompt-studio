import type { PromptGraphModel } from '@prompt-studio/prompts';
import { useMemo, useState } from 'react';
import type { LayoutPosition } from './layout';

/** View state only: arranging nodes never changes the prompt model or source. */
// shortcut: positions last for this mounted canvas; add project view-state storage when layout persistence is requested.
export function useCanvasLayout(model: PromptGraphModel, defaults: ReadonlyMap<string, LayoutPosition>) {
  const graph = model.nodes
    .filter((node) => node.kind === 'root')
    .map((node) => node.id)
    .join('\0');
  const ids = model.nodes.map((node) => node.id).join('\0');
  const [view, setView] = useState({
    graph,
    ids,
    positions: new Map<string, LayoutPosition>(),
    selected: new Set<string>(),
  });
  if (view.graph !== graph || view.ids !== ids) {
    const alive = new Set(model.nodes.map((node) => node.id));
    setView({
      graph,
      ids,
      positions: new Map([...view.positions].filter(([id]) => view.graph === graph && alive.has(id))),
      selected: new Set([...view.selected].filter((id) => view.graph === graph && alive.has(id))),
    });
  }
  const positions = useMemo(() => new Map([...defaults, ...view.positions]), [defaults, view.positions]);
  return {
    positions,
    selected: view.selected,
    moved: view.positions.size > 0,
    move(id: string, position: LayoutPosition) {
      setView((current) => ({ ...current, positions: new Map(current.positions).set(id, position) }));
    },
    select(id: string, selected: boolean) {
      setView((current) => {
        const next = new Set(current.selected);
        if (selected) next.add(id);
        else next.delete(id);
        return { ...current, selected: next };
      });
    },
    arrange() {
      setView((current) => ({ ...current, positions: new Map() }));
    },
  };
}
