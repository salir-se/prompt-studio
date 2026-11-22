import { hotkeysCoreFeature, syncDataLoaderFeature, type TreeInstance } from '@headless-tree/core';
import { useTree } from '@headless-tree/react';
import type { PromptTreeNode } from '@prompt-studio/prompts';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { OUTLINE_ROOT, type OutlineItem, outlineModel, visibleOutlineFocus } from './prompt-outline-model';

const navigationKeys = {
  focusNextItem: 'ArrowDown',
  focusPreviousItem: 'ArrowUp',
  expandOrDown: 'ArrowRight',
  collapseOrUp: 'ArrowLeft',
  focusFirstItem: 'Home',
  focusLastItem: 'End',
};
const hasItems = (tree: TreeInstance<OutlineItem>) => tree.getItems().length > 0;

/** The library owns navigation; this adapter owns source updates and single-section activation. */
export function usePromptOutline(
  sections: readonly PromptTreeNode[],
  selectedNodeId: string | undefined,
  onSelect: (id: string) => void,
) {
  const model = useMemo(() => outlineModel(sections), [sections]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [focusPath, setFocusPath] = useState<string[]>([]);
  const focusWithin = useRef(false);
  const selectedId = selectedNodeId?.replace(/^section:/, '');
  const selected = model.items.get(selectedId ?? '') ?? model.items.get(model.root.children[0]);
  const expanded = useMemo(
    () =>
      [...model.items]
        .filter(([id, item]) => item.node && item.children.length && !collapsed.has(id))
        .map(([id]) => id),
    [model, collapsed],
  );
  const focusedItem = visibleOutlineFocus(
    model,
    focusPath.length ? focusPath : (selected?.path ?? []),
    new Set(expanded),
  );
  const tree = useTree<OutlineItem>({
    rootItemId: OUTLINE_ROOT,
    state: { expandedItems: expanded, focusedItem },
    setExpandedItems: (updater) => {
      const next = new Set(typeof updater === 'function' ? updater(expanded) : updater);
      setCollapsed(
        new Set(
          [...model.items].filter(([id, item]) => item.node && item.children.length && !next.has(id)).map(([id]) => id),
        ),
      );
    },
    setFocusedItem: (updater) => {
      const next = typeof updater === 'function' ? updater(focusedItem) : updater;
      setFocusPath(model.items.get(next ?? '')?.path ?? []);
    },
    dataLoader: {
      getItem: (id) => model.items.get(id)!,
      getChildren: (id) => model.items.get(id)?.children ?? [],
    },
    getItemName: (item) => item.getItemData().node?.title ?? 'Prompt sections',
    isItemFolder: (item) => item.getItemData().children.length > 0,
    onPrimaryAction: (item) => onSelect(`section:${item.getId()}`),
    features: [syncDataLoaderFeature, hotkeysCoreFeature],
    hotkeys: {
      // Include each key string: partial overrides without it are unsafe in Headless Tree 1.8.
      ...Object.fromEntries(
        Object.entries(navigationKeys).map(([name, hotkey]) => [
          name,
          { hotkey, preventDefault: true, isEnabled: hasItems },
        ]),
      ),
      expandOrDown: {
        hotkey: 'ArrowRight',
        preventDefault: true,
        isEnabled: (instance) => hasItems(instance) && instance.getFocusedItem().isFolder(),
      },
      customActivateSection: {
        hotkey: 'Enter',
        preventDefault: true,
        isEnabled: hasItems,
        handler: (_, instance) => instance.getFocusedItem().primaryAction(),
      },
      customActivateSectionSpace: {
        hotkey: 'Space',
        preventDefault: true,
        isEnabled: hasItems,
        handler: (_, instance) => instance.getFocusedItem().primaryAction(),
      },
    },
  });
  const items = tree.getItems().filter((item) => model.items.has(item.getId()));

  useLayoutEffect(() => {
    tree.rebuildTree();
  }, [model, tree]);

  useLayoutEffect(() => {
    // Normal arrow navigation belongs to the library's asynchronous DOM focus owner.
    if (!focusWithin.current || focusedItem === focusPath[0]) return;
    const target = items.length ? tree.getItemInstance(focusedItem!).getElement() : tree.getElement();
    if (target && !target.contains(document.activeElement)) target.focus();
  }, [tree, focusedItem, focusPath, items]);

  useEffect(() => {
    const ancestors = model.items.get(selectedId ?? '')?.path.slice(1) ?? [];
    setCollapsed((current) => {
      if (!ancestors.some((id) => current.has(id))) return current;
      return new Set([...current].filter((id) => !ancestors.includes(id)));
    });
  }, [selectedId, model]);

  return { tree, items, selected, focusWithin };
}
