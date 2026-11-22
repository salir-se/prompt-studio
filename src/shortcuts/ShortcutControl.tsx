import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@prompt-studio/ui/tooltip';
import type { ReactElement } from 'react';
import { ShortcutKeys } from './ShortcutKeys';
import { useShortcutEducation } from './shortcut-context';
import { type ShortcutId, SHORTCUTS } from './shortcuts';

/** The child retains its event handler and ref, including popover/menu triggers. */
export function ShortcutControl({ id, label, children }: { id?: ShortcutId; label?: string; children: ReactElement }) {
  const education = useShortcutEducation();
  return (
    <TooltipProvider delayDuration={400}>
      <Tooltip>
        <TooltipTrigger
          asChild
          aria-keyshortcuts={id ? SHORTCUTS[id].keys : undefined}
          onClick={(event) => {
            if (id && event.detail > 0 && !event.defaultPrevented) education.teach(id);
          }}
        >
          {children}
        </TooltipTrigger>
        <TooltipContent sideOffset={6}>
          <span>{label ?? (id ? SHORTCUTS[id].label : '')}</span>
          {id && <ShortcutKeys id={id} />}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
