/** Transform and opacity motion. Retargeting keeps spring momentum. */
export const MOTION = {
  springs: {
    snappy: { stiffness: 600, damping: 40, mass: 1, settleMs: 280 },
    default: { stiffness: 400, damping: 36, mass: 1, settleMs: 360 },
    gentle: { stiffness: 260, damping: 32, mass: 1, settleMs: 460 },
  },
  fades: { enterMs: 140, exitMs: 100 },
  reduced: { fadeMs: 80 },
  completion: { initialOpacity: 0.4 },
  disclosure: { initialY: -4 },
} as const;

type Values = { x?: number; y?: number; opacity?: number; rotate?: number };
type Axis = keyof Values;
type Options = {
  spring?: keyof typeof MOTION.springs;
  from?: Values;
  /** Layout changes may rebase coordinates while retaining the existing velocity. */
  rebase?: boolean;
  reducedMotion?: boolean;
  durationMs?: number;
  onComplete?: () => void;
};
type Particle = { value: number; velocity: number; target: number; from: number; start: number };
type Motion = {
  axes: Partial<Record<Axis, Particle>>;
  frame: number;
  last: number;
  options: Options;
  transform: string;
  opacity: string;
  generation: number;
};
const motions = new WeakMap<HTMLElement, Motion>();

function paint(element: HTMLElement, motion: Motion): void {
  const { x, y, rotate, opacity } = motion.axes;
  if (x || y || rotate) {
    // An x offset is painted only when that axis moves, so y-only motion keeps its transform string.
    const translateX = x ? ` translateX(${x.value}px)` : '';
    element.style.transform = `${motion.transform}${translateX} translateY(${y?.value ?? 0}px) rotate(${rotate?.value ?? 0}deg)`;
  }
  if (opacity) element.style.opacity = String(opacity.value);
}

function restore(element: HTMLElement, motion: Motion): void {
  cancelAnimationFrame(motion.frame);
  if (motion.axes.x || motion.axes.y || motion.axes.rotate) element.style.transform = motion.transform;
  if (motion.axes.opacity) element.style.opacity = motion.opacity;
  motions.delete(element);
}

/** Cleanup cancels this invocation; an earlier cleanup cannot cancel a newer target. */
export function animateMotion(element: HTMLElement, target: Values, options: Options = {}): () => void {
  const now = performance.now();
  const motion = motions.get(element) ?? {
    axes: {},
    frame: 0,
    last: now,
    options,
    transform: element.style.transform,
    opacity: element.style.opacity,
    generation: 0,
  };
  cancelAnimationFrame(motion.frame);
  motion.options = options;
  motion.last = now;
  const generation = ++motion.generation;
  for (const axis of Object.keys(target) as Axis[]) {
    const previous = motion.axes[axis];
    const value =
      previous && !options.rebase
        ? previous.value
        : (options.from?.[axis] ?? previous?.value ?? (axis === 'opacity' ? 1 : 0));
    motion.axes[axis] = {
      value,
      velocity: previous?.velocity ?? 0,
      target: target[axis] ?? value,
      from: value,
      start: now,
    };
  }
  if (options.reducedMotion) {
    for (const axis of ['x', 'y', 'rotate'] as const) {
      const particle = motion.axes[axis];
      if (particle) {
        particle.value = particle.target;
        particle.velocity = 0;
      }
    }
  }
  motions.set(element, motion);
  paint(element, motion);

  const step = (time: number) => {
    let settled = true;
    const elapsed = Math.min(Math.max(time - motion.last, 0), 64) / 1000;
    motion.last = time;
    const spring = MOTION.springs[motion.options.spring ?? 'default'];
    for (const axis of Object.keys(motion.axes) as Axis[]) {
      const particle = motion.axes[axis];
      if (!particle) continue;
      if (axis === 'opacity') {
        const duration = motion.options.reducedMotion
          ? MOTION.reduced.fadeMs
          : (motion.options.durationMs ?? MOTION.fades.enterMs);
        const progress = Math.min((time - particle.start) / duration, 1);
        particle.value = particle.from + (particle.target - particle.from) * progress;
      } else {
        // Small steps remain stable when a frame is delayed.
        const steps = Math.max(1, Math.ceil(elapsed * 120));
        const dt = elapsed / steps;
        for (let index = 0; index < steps; index++) {
          particle.velocity +=
            ((spring.stiffness * (particle.target - particle.value) - spring.damping * particle.velocity) /
              spring.mass) *
            dt;
          particle.value += particle.velocity * dt;
        }
      }
      if (Math.abs(particle.target - particle.value) > 0.01 || Math.abs(particle.velocity) > 0.1) settled = false;
    }
    paint(element, motion);
    if (settled) {
      restore(element, motion);
      motion.options.onComplete?.();
    } else {
      motion.frame = requestAnimationFrame(step);
    }
  };
  motion.frame = requestAnimationFrame(step);
  return () => {
    if (motions.get(element) === motion && motion.generation === generation) restore(element, motion);
  };
}

/** Capture natural layout positions; later playback adds the current spring offset. */
export function captureMotionLayout(elements: Iterable<HTMLElement>): Map<HTMLElement, number> {
  return new Map(
    Array.from(elements, (element) => [
      element,
      element.getBoundingClientRect().top - (motions.get(element)?.axes.y?.value ?? 0),
    ]),
  );
}

/** Batch all geometry reads before applying FLIP transforms. No heights are animated. */
export function animateMotionLayout(
  before: Map<HTMLElement, number>,
  options: Pick<Options, 'reducedMotion'> = {},
): () => void {
  const offsets = Array.from(before, ([element, top]) => {
    const currentY = motions.get(element)?.axes.y?.value ?? 0;
    const naturalTop = element.getBoundingClientRect().top - currentY;
    return { element, y: top - naturalTop + currentY };
  });
  const cleanups = offsets
    .filter(({ element, y }) => element.isConnected && (Math.abs(y) > 0.01 || motions.has(element)))
    .map(({ element, y }) => animateMotion(element, { y: 0 }, { ...options, from: { y }, rebase: true }));
  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}
