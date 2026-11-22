'use client';

import * as TabsPrimitive from '@radix-ui/react-tabs';
import { cva, type VariantProps } from 'class-variance-authority';
import * as React from 'react';
import { cn } from './utils';

function Tabs({ className, orientation = 'horizontal', ...props }: React.ComponentProps<typeof TabsPrimitive.Root>) {
  return (
    <TabsPrimitive.Root
      orientation={orientation}
      data-slot="tabs"
      data-orientation={orientation}
      data-layout-contract={orientation === 'horizontal' ? 'stack' : 'inline'}
      data-layout-gap="8"
      data-layout-align="stretch"
      data-layout-wrap={orientation === 'vertical' ? 'nowrap' : undefined}
      className={cn('group/tabs flex gap-2 data-horizontal:flex-col', className)}
      {...props}
    />
  );
}

/**
 * `line` is the one tab design for pages and dialogs alike: an underlined strip whose tabs keep their own width,
 * start at the left edge, and scroll sideways instead of squeezing at 375 px. `pill` is the segmented control, only
 * on explicit request. Keep the list's `p-1`: the active underline sits in that padding, so removing it (or
 * `overflow-y-hidden`) crops the indicator. The strip owns its card surface and bottom divider (`bg-card border-b`), as on pages, so callers add only width
 * and gutters; a navigation bar whose wrapper already draws both passes `bg-transparent border-b-0`. Below `md` the shared touch-target rule makes each tab fill the strip, so
 * the underline moves to the tab's own bottom edge there instead of hanging below it.
 */
const tabsListVariants = cva(
  'group/tabs-list inline-flex w-fit items-center rounded-lg p-1 text-muted-foreground group-data-horizontal/tabs:h-8 group-data-horizontal/tabs:min-h-11 md:group-data-horizontal/tabs:min-h-0 group-data-vertical/tabs:h-fit group-data-vertical/tabs:flex-col data-[variant=line]:rounded-none',
  {
    variants: {
      variant: {
        line: 'max-w-full justify-start gap-1 overflow-x-auto border-b bg-card max-md:group-data-horizontal/tabs:min-h-[calc(var(--touch-target)+1px)] group-data-vertical/tabs:border-b-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden',
        pill: 'justify-center bg-muted',
      },
    },
    defaultVariants: {
      variant: 'line',
    },
  },
);

/** Horizontal room kept beside the revealed tab, so the neighbouring tab stays half-visible as a "more" hint. */
const REVEAL_MARGIN_PX = 24;

/**
 * An overflowing `line` strip scrolls sideways, so a selected tab can sit past its edge (a deep link, or arrow keys
 * on a phone). Keep the active tab in view by scrolling the list itself — never `scrollIntoView`, which would also
 * scroll the page.
 */
function useRevealActiveTab(list: HTMLDivElement | null) {
  React.useEffect(() => {
    if (!list) return;
    const reveal = () => {
      if (list.scrollWidth <= list.clientWidth) return;
      const active = list.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
      if (!active) return;
      const bounds = list.getBoundingClientRect();
      const tab = active.getBoundingClientRect();
      if (tab.left < bounds.left) list.scrollLeft -= bounds.left - tab.left + REVEAL_MARGIN_PX;
      else if (tab.right > bounds.right) list.scrollLeft += tab.right - bounds.right + REVEAL_MARGIN_PX;
    };
    reveal();
    const observer = new MutationObserver(reveal);
    observer.observe(list, { subtree: true, attributes: true, attributeFilter: ['data-state'] });
    return () => observer.disconnect();
  }, [list]);
}

function TabsList({
  className,
  variant = 'line',
  ref,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List> & VariantProps<typeof tabsListVariants>) {
  const [list, setList] = React.useState<HTMLDivElement | null>(null);
  useRevealActiveTab(variant === 'line' ? list : null);
  const composedRef = React.useCallback(
    (node: HTMLDivElement | null) => {
      setList(node);
      if (typeof ref === 'function') ref(node);
      else if (ref) ref.current = node;
    },
    [ref],
  );
  return (
    <TabsPrimitive.List
      ref={composedRef}
      data-slot="tabs-list"
      data-variant={variant}
      className={cn(tabsListVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsTrigger({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      className={cn(
        "relative inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-2 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap text-foreground/80 transition-all group-data-vertical/tabs:w-full group-data-vertical/tabs:justify-start hover:text-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-1 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-50 has-data-[icon=inline-end]:pr-1 has-data-[icon=inline-start]:pl-1 dark:text-muted-foreground dark:hover:text-foreground group-data-[variant=pill]/tabs-list:data-active:shadow-sm group-data-[variant=line]/tabs-list:data-active:shadow-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        'group-data-[variant=line]/tabs-list:flex-none group-data-[variant=line]/tabs-list:bg-transparent group-data-[variant=line]/tabs-list:focus-visible:ring-inset group-data-[variant=line]/tabs-list:focus-visible:-outline-offset-2 group-data-[variant=line]/tabs-list:data-active:bg-transparent dark:group-data-[variant=line]/tabs-list:data-active:border-transparent dark:group-data-[variant=line]/tabs-list:data-active:bg-transparent',
        'data-active:bg-background data-active:text-foreground dark:data-active:border-input dark:data-active:bg-input/30 dark:data-active:text-foreground',
        'after:absolute after:bg-foreground after:opacity-0 after:transition-opacity group-data-horizontal/tabs:after:inset-x-0 group-data-horizontal/tabs:after:bottom-[-5px] max-md:group-data-horizontal/tabs:after:bottom-0 group-data-horizontal/tabs:after:h-0.5 group-data-vertical/tabs:after:inset-y-0 group-data-vertical/tabs:after:-right-1 group-data-vertical/tabs:after:w-0.5 group-data-[variant=line]/tabs-list:data-active:after:opacity-100',
        className,
      )}
      {...props}
    />
  );
}

function TabsContent({ className, ...props }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      className={cn('flex-1 text-sm outline-none', className)}
      {...props}
    />
  );
}

export { Tabs, TabsContent, TabsList, TabsTrigger, tabsListVariants };
