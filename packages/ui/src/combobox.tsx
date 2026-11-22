import { Combobox as ComboboxPrimitive } from '@base-ui/react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupInput } from './input-group';
import { QuickSearch } from './quick-search';
import { cn } from './utils';

const Combobox = ComboboxPrimitive.Root;
const ComboboxEmpty = ComboboxPrimitive.Empty;

function keepComboboxSearchOpen(details: ComboboxPrimitive.Root.ChangeEventDetails) {
  const event = details.event;
  if (details.reason !== 'focus-out' || !(event instanceof FocusEvent) || !(event.target instanceof Element)) {
    return false;
  }
  if (
    !(event.relatedTarget instanceof Node) ||
    !event.target.closest('[data-quick-search]')?.contains(event.relatedTarget)
  ) {
    return false;
  }
  details.cancel();
  return true;
}

function ComboboxTrigger({ className, children, ...props }: ComboboxPrimitive.Trigger.Props) {
  return (
    <ComboboxPrimitive.Trigger
      data-slot="combobox-trigger"
      data-layout-contract="inline"
      data-layout-gap="8"
      data-layout-align="center"
      data-layout-wrap="nowrap"
      className={cn("inline-flex items-center gap-2 whitespace-nowrap [&_svg:not([class*='size-'])]:size-4", className)}
      {...props}
    >
      {children}
      <ChevronDownIcon className="pointer-events-none size-4 text-muted-foreground" />
    </ComboboxPrimitive.Trigger>
  );
}

function ComboboxInput({
  className,
  children,
  disabled = false,
  showTrigger = true,
  search,
  ...props
}: ComboboxPrimitive.Input.Props & { showTrigger?: boolean; search?: { value: string; onClear: () => void } }) {
  const input = (inputProps?: React.ComponentProps<typeof InputGroupInput>) => (
    <ComboboxPrimitive.Input render={<InputGroupInput disabled={disabled} {...inputProps} />} {...props} />
  );
  const trigger = showTrigger && (
    <InputGroupAddon align="inline-end">
      <InputGroupButton size="icon-xs" variant="ghost" asChild disabled={disabled}>
        <ComboboxTrigger />
      </InputGroupButton>
    </InputGroupAddon>
  );

  if (search) {
    return (
      <QuickSearch
        className={cn('w-auto', className)}
        value={search.value}
        onValueChange={search.onClear}
        disabled={disabled}
        renderGroup={(group) => <ComboboxPrimitive.InputGroup render={group} />}
        renderInput={input}
      >
        {trigger}
        {children}
      </QuickSearch>
    );
  }

  return (
    <InputGroup className={cn('w-auto', className)}>
      {input()}
      {trigger}
      {children}
    </InputGroup>
  );
}

function ComboboxContent({
  className,
  side = 'bottom',
  sideOffset = 6,
  align = 'start',
  alignOffset = 0,
  ...props
}: ComboboxPrimitive.Popup.Props &
  Pick<ComboboxPrimitive.Positioner.Props, 'side' | 'align' | 'sideOffset' | 'alignOffset'>) {
  return (
    <ComboboxPrimitive.Portal>
      <ComboboxPrimitive.Positioner
        side={side}
        sideOffset={sideOffset}
        align={align}
        alignOffset={alignOffset}
        // Match Select: portalled controls sit above DialogContent (z-51).
        // Radix dialogs disable body pointer events; restore them for this portal.
        className="isolate z-52"
        style={{ pointerEvents: 'auto' }}
      >
        <ComboboxPrimitive.Popup
          data-slot="combobox-content"
          data-layout-contract="container"
          data-layout-contain="true"
          className={cn(
            'relative max-h-96 w-(--anchor-width) max-w-(--available-width) min-w-[calc(var(--anchor-width)+--spacing(7))] origin-(--transform-origin) overflow-hidden rounded-md bg-popover text-popover-foreground shadow-md ring-1 ring-foreground/10 duration-100 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
            className,
          )}
          {...props}
        />
      </ComboboxPrimitive.Positioner>
    </ComboboxPrimitive.Portal>
  );
}

function ComboboxList({ className, ...props }: ComboboxPrimitive.List.Props) {
  return (
    <ComboboxPrimitive.List
      data-slot="combobox-list"
      // The scrolling box owns the overflow contract: the layout inspector measures scrollWidth against
      // clientWidth here in a real browser, so a wide row fails the story instead of growing a scrollbar.
      data-layout-contract="container"
      data-layout-overflow-x="hidden"
      // Two rules keep a horizontal scrollbar out of this list, measured in the GenerationsPanel story
      // (scrollWidth 484 vs clientWidth 480 before the fix):
      // - `overflow-x-hidden`: `overflow-y-auto` alone computes overflow-x to `auto`, so any scrollable
      //   overflow grows a scrollbar. Select and DropdownMenu clip the same way.
      // - the padding collapses only when the list really has no items. Base UI sets `data-empty` whenever the
      //   consumer renders items as children instead of passing `items`, so the old `data-empty:p-0` zeroed the
      //   padding of a populated list and the full-bleed `-mx-1` separator overhung the box by 4 px.
      className={cn(
        'max-h-[min(24rem,var(--available-height))] scroll-py-1 overflow-x-hidden overflow-y-auto p-1 not-has-[[data-slot=combobox-item]]:p-0',
        className,
      )}
      {...props}
    />
  );
}

function ComboboxItem({ className, children, ...props }: ComboboxPrimitive.Item.Props) {
  return (
    <ComboboxPrimitive.Item
      data-slot="combobox-item"
      data-layout-contract="container"
      data-layout-contain="true"
      className={cn(
        'relative flex w-full cursor-default items-start gap-2 rounded-sm py-2 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ItemIndicator className="pointer-events-none absolute top-2.5 right-2 flex size-4 items-center justify-center">
        <CheckIcon className="size-4" />
      </ComboboxPrimitive.ItemIndicator>
    </ComboboxPrimitive.Item>
  );
}

/**
 * The selected item's label for a select-style trigger (no free-text input).
 * Renders `itemToStringLabel(value)` by default; pass a render-prop child to
 * customise.
 */
function ComboboxValue({ className, ...props }: ComboboxPrimitive.Value.Props & { className?: string }) {
  return (
    <span data-slot="combobox-value" className={cn('min-w-0 truncate text-left', className)}>
      <ComboboxPrimitive.Value {...props} />
    </span>
  );
}

function ComboboxChips({ className, ...props }: ComboboxPrimitive.Chips.Props) {
  return (
    <ComboboxPrimitive.Chips
      data-slot="combobox-chips"
      className={cn(
        'flex min-h-9 min-w-0 flex-wrap items-center gap-1 rounded-md border border-input bg-background px-2 py-1 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50',
        className,
      )}
      {...props}
    />
  );
}

function ComboboxChip({
  className,
  children,
  removeLabel,
  ...props
}: ComboboxPrimitive.Chip.Props & { removeLabel: string }) {
  return (
    <ComboboxPrimitive.Chip
      data-slot="combobox-chip"
      className={cn('inline-flex items-center gap-1 rounded bg-muted px-2 py-0.5 text-xs text-foreground', className)}
      {...props}
    >
      {children}
      <ComboboxPrimitive.ChipRemove aria-label={removeLabel} className="rounded px-1 hover:bg-background">
        ×
      </ComboboxPrimitive.ChipRemove>
    </ComboboxPrimitive.Chip>
  );
}

function ComboboxChipsInput({ className, ...props }: ComboboxPrimitive.Input.Props) {
  return (
    <ComboboxPrimitive.Input
      data-slot="combobox-chips-input"
      className={cn(
        'min-w-32! flex-1 bg-transparent py-0.5 text-xs text-foreground outline-none placeholder:text-muted-foreground',
        className,
      )}
      {...props}
    />
  );
}

const ComboboxChipsValue = ComboboxPrimitive.Value;

function ComboboxGroup({ className, ...props }: ComboboxPrimitive.Group.Props) {
  return (
    <ComboboxPrimitive.Group
      data-slot="combobox-group"
      data-layout-contract="grid"
      className={cn(className)}
      {...props}
    />
  );
}

function ComboboxLabel({ className, ...props }: ComboboxPrimitive.GroupLabel.Props) {
  return (
    <ComboboxPrimitive.GroupLabel
      data-slot="combobox-label"
      className={cn('px-2 py-2 text-xs text-muted-foreground', className)}
      {...props}
    />
  );
}

function ComboboxSeparator({ className, ...props }: ComboboxPrimitive.Separator.Props) {
  return (
    <ComboboxPrimitive.Separator
      data-slot="combobox-separator"
      className={cn('-mx-1 my-1 h-px bg-border', className)}
      {...props}
    />
  );
}

export {
  Combobox,
  ComboboxChip,
  ComboboxChips,
  ComboboxChipsInput,
  ComboboxChipsValue,
  ComboboxContent,
  ComboboxEmpty,
  ComboboxGroup,
  ComboboxInput,
  ComboboxItem,
  ComboboxLabel,
  ComboboxList,
  ComboboxSeparator,
  ComboboxTrigger,
  ComboboxValue,
  keepComboboxSearchOpen,
};
