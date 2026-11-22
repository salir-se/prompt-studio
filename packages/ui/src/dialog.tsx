import * as DialogPrimitive from '@radix-ui/react-dialog';
import { XIcon } from 'lucide-react';
import type * as React from 'react';
import { useCallback, useRef } from 'react';
import { TimelineScrollControls } from './timeline-scroll-region';
import { cn } from './utils';

function Dialog({ ...props }: React.ComponentProps<typeof DialogPrimitive.Root>) {
  return <DialogPrimitive.Root data-slot="dialog" {...props} />;
}

function DialogTrigger({ ...props }: React.ComponentProps<typeof DialogPrimitive.Trigger>) {
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" {...props} />;
}

function DialogPortal({ ...props }: React.ComponentProps<typeof DialogPrimitive.Portal>) {
  return <DialogPrimitive.Portal data-slot="dialog-portal" {...props} />;
}

function DialogClose({ ...props }: React.ComponentProps<typeof DialogPrimitive.Close>) {
  return <DialogPrimitive.Close data-slot="dialog-close" {...props} />;
}

function DialogOverlay({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Overlay>) {
  return (
    <DialogPrimitive.Overlay
      data-slot="dialog-overlay"
      className={cn(
        // `duration-200` matches DialogContent: a shorter overlay exit lets a
        // reopen during the gap mount the overlay after the content (#1643).
        'fixed inset-0 z-50 bg-black/50 duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
        className,
      )}
      {...props}
    />
  );
}

function DialogContentLayer({
  className,
  children,
  showCloseButton = true,
  ref,
  nativeScroll = false,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean;
  nativeScroll?: boolean;
}) {
  const viewport = useRef<HTMLDivElement>(null);
  const bindViewport = useCallback(
    (node: HTMLDivElement | null) => {
      viewport.current = node;
      if (typeof ref === 'function') return ref(node);
      if (ref) ref.current = node;
    },
    [ref],
  );
  return (
    <div style={{ display: 'contents' }}>
      <DialogOverlay />
      <DialogPrimitive.Content
        data-slot="dialog-content"
        data-layout-contract="container"
        data-layout-overflow-x="hidden"
        data-timeline-scroll-viewport={nativeScroll ? undefined : ''}
        ref={bindViewport}
        className={cn(
          // Shared. `z-51` keeps the content above its own overlay (`z-50`)
          // regardless of mount order — Presence lifetimes are independent, so
          // a reopen while the previous dialog exits can portal the overlay
          // after the content and intercept every click (#1643).
          'fixed z-51 grid gap-4 border bg-background shadow-lg duration-200 data-open:animate-in data-open:fade-in-0 data-closed:animate-out data-closed:fade-out-0',
          // Mobile: bottom sheet — full-width, anchored to the bottom, rounded top, slides up,
          // scrolls internally, and clears the home-indicator safe area.
          "inset-x-0 bottom-0 max-h-[92dvh] w-full overflow-x-hidden overflow-y-auto rounded-t-2xl rounded-b-none p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] before:mx-auto before:-mt-1 before:mb-1 before:h-1 before:w-10 before:shrink-0 before:rounded-full before:bg-muted-foreground/25 before:content-[''] data-open:slide-in-from-bottom data-closed:slide-out-to-bottom sm:before:hidden",
          // Desktop (sm+): restore the centered modal — overrides every mobile positioning rule.
          'sm:inset-x-auto sm:top-[50%] sm:bottom-auto sm:left-[50%] sm:max-h-[85vh] sm:max-w-lg sm:translate-x-[-50%] sm:translate-y-[-50%] sm:rounded-lg sm:p-6 sm:data-open:zoom-in-95 sm:data-open:slide-in-from-bottom-0 sm:data-closed:zoom-out-95 sm:data-closed:slide-out-to-bottom-0',
          className,
        )}
        {...props}
      >
        {!nativeScroll && <TimelineScrollControls viewportRef={viewport} inline />}
        {children}
        {showCloseButton && (
          <DialogPrimitive.Close
            data-slot="dialog-close"
            className="absolute top-4 right-4 rounded-xs opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-hidden focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <XIcon />
            <span className="sr-only">Close</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </div>
  );
}

function DialogContent(props: React.ComponentProps<typeof DialogContentLayer>) {
  return (
    <DialogPortal>
      {/* One portal preserves sibling order; its ref still reaches Content so Presence tracks the exit animation. */}
      <DialogContentLayer {...props} />
    </DialogPortal>
  );
}

function DialogHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-header"
      data-layout-contract="stack"
      data-layout-gap="8"
      data-layout-align="start"
      className={cn('flex flex-col gap-2 text-left', className)}
      {...props}
    />
  );
}

function DialogFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="dialog-footer"
      data-layout-contract="container"
      className={cn(
        // Mobile: full-width stacked actions (primary on top); Desktop: inline, right-aligned.
        'flex flex-col-reverse gap-2 [&>*]:w-full sm:flex-row sm:justify-end sm:[&>*]:w-auto',
        className,
      )}
      {...props}
    />
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      className={cn('text-lg font-semibold leading-none', className)}
      {...props}
    />
  );
}

function DialogDescription({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      className={cn('text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
};
