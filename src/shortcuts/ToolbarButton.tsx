import { Button } from '@prompt-studio/ui/button';
import { cn } from '@prompt-studio/ui/utils';
import type { ComponentProps, ReactNode } from 'react';
import { ShortcutControl } from './ShortcutControl';
import { useShortcutEducation } from './shortcut-context';
import type { ShortcutId } from './shortcuts';

export function ToolbarButton({
  label,
  icon,
  shortcut,
  count,
  title,
  className,
  ...props
}: Omit<ComponentProps<typeof Button>, 'children'> & {
  label: string;
  icon: ReactNode;
  shortcut?: ShortcutId;
  count?: number;
}) {
  const { compactToolbars } = useShortcutEducation();
  return (
    <ShortcutControl id={shortcut} label={props.disabled && title ? title : shortcut ? undefined : label}>
      <Button
        {...props}
        title={props.disabled ? title : undefined}
        size={compactToolbars ? 'icon' : 'sm'}
        className={cn('studio-toolbar-button', className)}
        data-toolbar-mode={compactToolbars ? 'icons' : 'labels'}
      >
        <span aria-hidden="true" className="inline-flex shrink-0">
          {icon}
        </span>
        <span className={compactToolbars ? 'sr-only' : undefined}>
          {label}
          {count !== undefined && ` ${count}`}
        </span>
      </Button>
    </ShortcutControl>
  );
}
