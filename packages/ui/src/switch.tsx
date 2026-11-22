import { Switch as SwitchPrimitive } from '@base-ui/react/switch';
import type { ComponentProps } from 'react';
import { cn } from './utils';

export function Switch({ className, ...props }: ComponentProps<typeof SwitchPrimitive.Root>) {
  return (
    <SwitchPrimitive.Root
      data-slot="switch"
      className={cn(
        'group inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      <span
        data-slot="switch-track"
        aria-hidden="true"
        className="pointer-events-none flex h-6 w-10 items-center rounded-full bg-input transition-colors group-data-checked:bg-primary motion-reduce:transition-none"
      >
        <SwitchPrimitive.Thumb className="block size-4 translate-x-1 rounded-full bg-background shadow-sm transition-transform group-data-checked:translate-x-5 motion-reduce:transition-none" />
      </span>
    </SwitchPrimitive.Root>
  );
}
