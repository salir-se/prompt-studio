import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, Ban } from 'lucide-react';
import { Button } from '../button';
import type { RailAxis } from './timeline-rail-axis';
import { timelineArrowNudge } from './useTimelineArrowNudge';

const ICONS = { y: [ArrowUp, ArrowDown], x: [ArrowLeft, ArrowRight] } as const;

/**
 * One of the rail's two scroll arrows; with `motion` its icon is nudged while pressed. At its end of the page the
 * button is disabled and shows a half-transparent dead-end sign (a crossed circle) in place of the arrow. On a
 * horizontal rail (`axis` x) Up points left and Down right; both still scroll the page vertically.
 */
export function TimelineNavigatorArrow({
  direction,
  label,
  disabled,
  motion,
  onClick,
  axis = 'y',
}: {
  direction: -1 | 1;
  label: string;
  disabled: boolean;
  motion: boolean;
  onClick: () => void;
  axis?: RailAxis;
}): React.JSX.Element {
  const Icon = ICONS[axis][direction === 1 ? 1 : 0];
  return (
    <div className="timeline-navigator-arrow">
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        aria-label={label}
        disabled={disabled}
        data-end={disabled ? '' : undefined}
        onClick={onClick}
        {...timelineArrowNudge(motion, direction, axis)}
      >
        <span className="timeline-navigator-arrow-icons" aria-hidden="true">
          <Icon data-arrow="" />
          <Ban data-dead-end="" />
        </span>
      </Button>
    </div>
  );
}
