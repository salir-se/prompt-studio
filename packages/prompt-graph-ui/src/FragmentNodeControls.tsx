import { Button } from '@prompt-studio/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@prompt-studio/ui/dropdown-menu';
import { cn } from '@prompt-studio/ui/utils';
import type { FragmentNodeProps } from './FragmentNode';

/** Inline pencil glyph — matches lucide's `Pencil` path data/stroke conventions (no new dependency: this
 *  package doesn't declare `lucide-react`, so the icon is reproduced as a literal SVG instead). */
export function EditIcon(props: React.SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d="M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z" />
      <path d="m15 5 4 4" />
    </svg>
  );
}

/** Shared SVG shell for the small structure-action glyphs below — same lucide stroke conventions as
 *  `EditIcon` (this package deliberately declares no `lucide-react` dependency). */
function strokeIconProps(props: React.SVGProps<SVGSVGElement>): React.SVGProps<SVGSVGElement> {
  return {
    xmlns: 'http://www.w3.org/2000/svg',
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    ...props,
  };
}

/** lucide `ArrowUp`. */
function ArrowUpIcon(props: React.SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg {...strokeIconProps(props)} aria-hidden="true">
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </svg>
  );
}

/** lucide `ArrowDown`. */
function ArrowDownIcon(props: React.SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg {...strokeIconProps(props)} aria-hidden="true">
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </svg>
  );
}

/** lucide `Plus`. */
function PlusIcon(props: React.SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg {...strokeIconProps(props)} aria-hidden="true">
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </svg>
  );
}

/** lucide `CornerDownRight` — the "nested under this" glyph for the add-sub-section action. */
function CornerDownRightIcon(props: React.SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg {...strokeIconProps(props)} aria-hidden="true">
      <path d="m15 10 5 5-5 5" />
      <path d="M4 4v7a4 4 0 0 0 4 4h12" />
    </svg>
  );
}

/** lucide `Trash2`. */
function TrashIcon(props: React.SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg {...strokeIconProps(props)} aria-hidden="true">
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </svg>
  );
}

/** Inline chevron glyph — matches lucide's `ChevronDown` path; rotates to point right when collapsed
 *  (the conventional "expand this" affordance) and down when expanded ("collapse this"). */
export function CollapseChevronIcon({
  expanded,
  className,
  ...props
}: { expanded: boolean } & React.SVGProps<SVGSVGElement>): React.JSX.Element {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={cn('transition-transform', expanded ? 'rotate-0' : '-rotate-90', className)}
      {...props}
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

/**
 * Wraps a click handler with `stopPropagation()`. Every interactive control rendered by this card
 * (Edit, the collapse toggle, the raw/rendered mode toggle, and every structure-action button) sits
 * physically inside whatever xyflow node wrapper renders the card (see `PromptGraphCanvas`'s
 * `SectionFlowNodeComponent`), and xyflow's own node click-to-select handling listens for clicks on
 * that wrapper via event bubbling. Without this, clicking any one of those buttons would ALSO
 * silently select (or re-select) the node as an unintended side effect of the click bubbling past
 * this card's own boundary — a real UX defect (an "Edit"/"Move down"/etc. click has no business
 * changing selection), and the direct cause of a React-act() warning under test: the incidental
 * xyflow selection-store update lands outside the click's own `act()` scope (`SelectionListenerInner`
 * reacting to a store change the test never intended to trigger).
 */
export function stopPropagationAnd(handler: () => void): (event: React.MouseEvent) => void {
  return (event) => {
    event.stopPropagation();
    handler();
  };
}

export function SectionActionBar({
  actions,
}: {
  actions: NonNullable<FragmentNodeProps['sectionActions']>;
}): React.JSX.Element {
  return (
    <div
      className="nodrag nopan nokey flex shrink-0 items-center gap-1"
      role="toolbar"
      aria-label="Section structure actions"
      data-testid="fragment-node-actions"
    >
      {actions.onMoveUp && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Move section up"
          onClick={stopPropagationAnd(actions.onMoveUp)}
        >
          <ArrowUpIcon className="size-3.5" />
        </Button>
      )}
      {actions.onMoveDown && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Move section down"
          onClick={stopPropagationAnd(actions.onMoveDown)}
        >
          <ArrowDownIcon className="size-3.5" />
        </Button>
      )}
      {actions.onAddSiblingSection && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Add section after"
          onClick={stopPropagationAnd(actions.onAddSiblingSection)}
        >
          <PlusIcon className="size-3.5" />
        </Button>
      )}
      {actions.onAddChildSection && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Add sub-section"
          onClick={stopPropagationAnd(actions.onAddChildSection)}
        >
          <CornerDownRightIcon className="size-3.5" />
        </Button>
      )}
      {actions.onRemoveSection && (
        <Button
          variant="ghost"
          size="icon-xs"
          aria-label="Remove section"
          className="text-destructive hover:text-destructive"
          onClick={stopPropagationAnd(actions.onRemoveSection)}
        >
          <TrashIcon className="size-3.5" />
        </Button>
      )}
    </div>
  );
}

/** Collapsed sections expose the same structure actions without adding another row. */
export function SectionActionMenu({ actions }: { actions: NonNullable<FragmentNodeProps['sectionActions']> }) {
  const entries = [
    ['Move section up', actions.onMoveUp],
    ['Move section down', actions.onMoveDown],
    ['Add section after', actions.onAddSiblingSection],
    ['Add sub-section', actions.onAddChildSection],
    ['Remove section', actions.onRemoveSection],
  ] as const;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Section actions"
          title="Section actions"
          className="nodrag nopan"
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
        >
          <svg viewBox="0 0 24 24" className="size-3.5" fill="currentColor" aria-hidden="true">
            <circle cx="5" cy="12" r="2" />
            <circle cx="12" cy="12" r="2" />
            <circle cx="19" cy="12" r="2" />
          </svg>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => event.stopPropagation()}
      >
        {entries.map(
          ([label, action]) =>
            action && (
              <DropdownMenuItem
                key={label}
                variant={label === 'Remove section' ? 'destructive' : 'default'}
                onSelect={action}
              >
                {label}
              </DropdownMenuItem>
            ),
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
