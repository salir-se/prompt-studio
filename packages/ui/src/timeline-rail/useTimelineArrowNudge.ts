import type { KeyboardEvent, PointerEvent } from 'react';
import { animateMotion } from '../motion';
import type { RailAxis } from './timeline-rail-axis';

const NUDGE_PX = 2;
const isPress = (event: KeyboardEvent) => (event.key === 'Enter' || event.key === ' ') && !event.repeat;

/**
 * Press feedback for a rail arrow: while pressed the button carries `data-pressed` (the stylesheet moves its icon
 * `NUDGE_PX` in the arrow's direction along `data-axis`) and on release the icon springs back from there. Returns no
 * handlers when motion is off, so the button keeps its plain behavior. `direction` is -1 for Up and 1 for Down; on a
 * horizontal rail (`axis` x) Up points left and Down right.
 */
export function timelineArrowNudge(motion: boolean, direction: -1 | 1, axis: RailAxis = 'y') {
  if (!motion) return {};
  const release = (button: HTMLElement) => {
    if (!button.hasAttribute('data-pressed')) return;
    button.removeAttribute('data-pressed');
    const icon = button.querySelector<SVGElement>('svg');
    if (icon) {
      const from = axis === 'x' ? { x: direction * NUDGE_PX } : { y: direction * NUDGE_PX };
      animateMotion(icon as unknown as HTMLElement, axis === 'x' ? { x: 0 } : { y: 0 }, { from, spring: 'snappy' });
    }
  };
  return {
    'data-direction': direction === 1 ? 'down' : 'up',
    'data-axis': axis,
    onPointerDown: (event: PointerEvent<HTMLElement>) => {
      if (event.button === 0) event.currentTarget.setAttribute('data-pressed', '');
    },
    onPointerUp: (event: PointerEvent<HTMLElement>) => release(event.currentTarget),
    onPointerLeave: (event: PointerEvent<HTMLElement>) => release(event.currentTarget),
    onPointerCancel: (event: PointerEvent<HTMLElement>) => release(event.currentTarget),
    onBlur: (event: { currentTarget: HTMLElement }) => release(event.currentTarget),
    onKeyDown: (event: KeyboardEvent<HTMLElement>) => {
      if (isPress(event)) event.currentTarget.setAttribute('data-pressed', '');
    },
    onKeyUp: (event: KeyboardEvent<HTMLElement>) => {
      if (event.key === 'Enter' || event.key === ' ') release(event.currentTarget);
    },
  };
}
