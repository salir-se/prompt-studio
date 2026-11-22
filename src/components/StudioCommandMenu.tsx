import { Button } from '@prompt-studio/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@prompt-studio/ui/dropdown-menu';
import { type ReactNode, useRef } from 'react';
import { ShortcutControl } from '../shortcuts/ShortcutControl';
import { ShortcutKeys } from '../shortcuts/ShortcutKeys';
import { ToolbarButton } from '../shortcuts/ToolbarButton';
import type { ShortcutId } from '../shortcuts/shortcuts';

export function StudioCommandMenu({
  label,
  commands,
  icon,
}: {
  label: string;
  icon?: ReactNode;
  commands: readonly { label: string; run: () => void; disabled?: boolean; reason?: string; shortcut?: ShortcutId }[];
}) {
  const trigger = useRef<HTMLButtonElement>(null);
  const pending = useRef<(() => void) | null>(null);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {icon ? (
          <ToolbarButton
            ref={trigger}
            type="button"
            variant="outline"
            label={label}
            icon={icon}
            data-studio-command-menu={label}
          />
        ) : (
          <Button ref={trigger} type="button" variant="outline" size="sm" data-studio-command-menu={label}>
            {label} <span aria-hidden="true">⌄</span>
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        className="studio w-56"
        onCloseAutoFocus={(event) => {
          const run = pending.current;
          pending.current = null;
          if (!run) return;
          // Dialogs capture a durable opener after the transient menu item has unmounted.
          event.preventDefault();
          trigger.current?.focus();
          run();
        }}
      >
        {commands.map((command) => {
          const item = (
            <DropdownMenuItem
              key={command.label}
              onSelect={() => {
                pending.current = command.run;
              }}
              disabled={command.disabled}
              title={command.reason}
            >
              <span className="flex-1">{command.label}</span>
              {command.shortcut && <ShortcutKeys id={command.shortcut} />}
            </DropdownMenuItem>
          );
          return command.shortcut ? (
            <ShortcutControl key={command.label} id={command.shortcut}>
              {item}
            </ShortcutControl>
          ) : (
            item
          );
        })}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
