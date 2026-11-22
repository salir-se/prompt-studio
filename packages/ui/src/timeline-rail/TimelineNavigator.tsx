import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@prompt-studio/ui/tooltip';
import { type RefObject, useState } from 'react';
import { m } from '../text';
import { useReducedMotion } from '../use-reduced-motion';
import { TimelineNavigatorArrow } from './TimelineNavigatorArrow';
import { TIMELINE_RAIL_COPY as C } from './copy';
import { railAxis, type TimelineRailOrientation } from './timeline-rail-axis';
import { useTimelineNavigation } from './useTimelineNavigation';
import { useTimelineRailDrag } from './useTimelineRailDrag';
import { useTimelineRailMotion } from './useTimelineRailMotion';
import { useTimelineRailPointer } from './useTimelineRailPointer';

/** What a destination is, so the rail can draw a distinct mark per kind. */
export type TimelineNavigationKind =
  'boundary' | 'section' | 'draft' | 'reply' | 'activity' | 'transition' | 'decision';

export interface TimelineNavigationItem {
  key: string;
  targetId: string;
  label: string;
  kind?: TimelineNavigationKind;
  edge?: 'start' | 'end';
}

/**
 * `animate={false}` (deterministic stories and tests) and `prefers-reduced-motion` both keep the static rail: no
 * indicator, no strip slide, no tick proximity or arrow nudge, and no `data-animate`. The landing
 * flash on a jump's destination is the one effect that stays under reduced motion, as a short fade.
 *
 * `orientation="horizontal"` lays the control out as a row, for a pane edge with no side room: the marks, the drag,
 * the wheel, pointer proximity and the arrow keys work along x. The page it navigates still scrolls vertically.
 */
export function TimelineNavigator({
  items,
  onReveal,
  viewportRef,
  animate = true,
  orientation = 'vertical',
  labels,
  boundaries,
}: {
  items: TimelineNavigationItem[];
  onReveal?: (key: string) => void;
  viewportRef: RefObject<HTMLElement | null>;
  animate?: boolean;
  orientation?: TimelineRailOrientation;
  /** The rail's name and its marks group's name; the Conversation timeline's by default. */
  labels?: { timeline: string; jump: string };
  boundaries?: { top: string; bottom: string };
}): React.JSX.Element | null {
  const axis = railAxis(orientation);
  const destinations = boundaries
    ? [
        { key: 'top', targetId: '', label: boundaries.top, kind: 'boundary' as const, edge: 'start' as const },
        ...items,
        { key: 'bottom', targetId: '', label: boundaries.bottom, kind: 'boundary' as const, edge: 'end' as const },
      ]
    : items;
  const navigation = useTimelineNavigation(destinations, viewportRef, onReveal, { animate, axis });
  const reducedMotion = useReducedMotion();
  const motion = animate && !reducedMotion;
  const { stripRef, indicatorRef } = useTimelineRailMotion({
    enabled: motion,
    reducedMotion,
    start: navigation.start,
    activeIndex: navigation.activeIndex,
    count: destinations.length,
    reason: navigation.shiftReason,
    axis,
  });
  useTimelineRailPointer({
    enabled: motion,
    marksRef: navigation.marksRef,
    stripRef,
    start: navigation.start,
    count: destinations.length,
    axis,
  });
  // One tooltip at a time: the hovered mark, else the focused one. Closed tooltips unmount at once, so a run of
  // arrow keys never stacks fading labels.
  const [hovered, setHovered] = useState<number | null>(null);
  const [focused, setFocused] = useState<number | null>(null);
  // A drag captures the pointer, so marks see no enter or leave: no tooltip until the pointer moves again.
  const [dragging, setDragging] = useState(false);
  const shown = dragging ? null : (hovered ?? focused);
  useTimelineRailDrag({
    marksRef: navigation.marksRef,
    viewportRef,
    items: destinations,
    nudgeWindow: navigation.nudgeWindow,
    axis,
    onDragChange: (active) => {
      setDragging(active);
      if (!active) setHovered(null);
    },
  });
  if (!destinations.length) return null;
  return (
    <nav
      ref={navigation.navRef}
      aria-label={labels?.timeline ?? m(C.timeline)}
      className="timeline-navigator"
      data-timeline-navigator
      data-orientation={orientation}
      data-animate={motion ? '' : undefined}
      data-held={navigation.held ? '' : undefined}
    >
      <TooltipProvider>
        <TimelineNavigatorArrow
          direction={-1}
          label={m(C.up)}
          disabled={!navigation.up}
          motion={motion}
          axis={axis}
          onClick={() => navigation.scrollPage(-1)}
        />
        <div
          ref={navigation.marksRef}
          role="group"
          aria-label={labels?.jump ?? m(C.jump)}
          aria-description={m(C.keyboard)}
          aria-orientation={orientation}
          className="timeline-navigator-marks"
        >
          {motion && (
            <span
              ref={indicatorRef}
              aria-hidden="true"
              className="timeline-navigator-indicator"
              data-kind={destinations[navigation.activeIndex]?.kind}
            />
          )}
          <div ref={stripRef} className="timeline-navigator-strip">
            {navigation.marks.map(({ item, index, active, tabbable }) => (
              <Tooltip key={item.key} open={shown === index}>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    className="timeline-navigator-mark"
                    aria-label={item.label}
                    aria-current={active ? 'location' : undefined}
                    tabIndex={tabbable ? 0 : -1}
                    data-timeline-navigation-mark
                    data-index={index}
                    data-kind={item.kind}
                    data-active={active ? '' : undefined}
                    onClick={() => navigation.jump(index)}
                    onKeyDown={(event) => {
                      if (navigation.onMarkKey(event.key, index)) event.preventDefault();
                    }}
                    onPointerEnter={() => setHovered(index)}
                    onPointerLeave={() => setHovered((current) => (current === index ? null : current))}
                    onFocus={() => setFocused(index)}
                    onBlur={() => setFocused((current) => (current === index ? null : current))}
                  />
                </TooltipTrigger>
                {shown === index && <TooltipContent side={axis === 'x' ? 'top' : 'left'}>{item.label}</TooltipContent>}
              </Tooltip>
            ))}
          </div>
        </div>
        <TimelineNavigatorArrow
          direction={1}
          label={m(C.down)}
          disabled={!navigation.down}
          motion={motion}
          axis={axis}
          onClick={() => navigation.scrollPage(1)}
        />
      </TooltipProvider>
    </nav>
  );
}
