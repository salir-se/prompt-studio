import { Button } from '@prompt-studio/ui/button';
import { Popover } from '@prompt-studio/ui/popover';
import { useLayoutEffect, useState } from 'react';
import { caretRectangle } from './caret-rectangle';
import type { Completion } from './composing';

/** Existing shadcn positioning handles collision/resize; the native textarea keeps focus and Undo. */
export function CompletionMenu({
  getEditor,
  text,
  caret,
  id,
  suggestions,
  selected,
  accept,
  dismiss,
}: {
  getEditor: () => HTMLTextAreaElement | null;
  text: string;
  caret: number | null;
  id: string;
  suggestions: readonly Completion[];
  selected: number;
  accept: (completion: Completion) => void;
  dismiss: () => void;
}) {
  const [anchor, setAnchor] = useState<{
    contextElement: HTMLTextAreaElement;
    getBoundingClientRect: () => DOMRect;
  } | null>(null);
  useLayoutEffect(() => {
    const editor = getEditor();
    if (!editor) return;
    const update = () => {
      const rect = caretRectangle(editor);
      setAnchor({ contextElement: editor, getBoundingClientRect: () => rect });
    };
    update();
    const resize = new ResizeObserver(update);
    resize.observe(editor);
    editor.ownerDocument.addEventListener('scroll', update, true);
    editor.ownerDocument.defaultView?.addEventListener('resize', update);
    return () => {
      resize.disconnect();
      editor.ownerDocument.removeEventListener('scroll', update, true);
      editor.ownerDocument.defaultView?.removeEventListener('resize', update);
    };
  }, [getEditor, text, caret]);
  if (!anchor) return null;
  return (
    <Popover.Root
      open
      modal={false}
      onOpenChange={(open) => {
        if (!open) dismiss();
      }}
    >
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          positionMethod="fixed"
          align="start"
          sideOffset={5}
          collisionPadding={8}
          className="z-50"
        >
          <Popover.Popup
            initialFocus={false}
            finalFocus={false}
            className="studio max-h-[min(16rem,var(--available-height))] w-[min(20rem,calc(100vw-1rem))] overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg"
            role="listbox"
            id={id}
            aria-label="Prompt suggestions"
          >
            <p className="px-2 py-1 text-xs text-muted-foreground">↑ ↓ choose · Enter / Tab insert · Esc dismiss</p>
            {suggestions.map((item, index) => (
              <Button
                key={item.label}
                id={`${id}-${index}`}
                role="option"
                aria-selected={index === selected}
                type="button"
                variant={index === selected ? 'secondary' : 'ghost'}
                tabIndex={-1}
                className="h-auto w-full justify-between gap-2 px-2 py-2 text-left"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => accept(item)}
              >
                <code className="truncate">{item.label}</code>
                <span className="text-xs text-muted-foreground">{item.detail}</span>
              </Button>
            ))}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
