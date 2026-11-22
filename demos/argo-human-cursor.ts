import type { Locator, Page } from '@playwright/test';

type CursorPage = Pick<Page, 'addInitScript' | 'evaluate' | 'mouse' | 'viewportSize' | 'waitForTimeout'>;

const CURSOR_ID = 'argo-human-cursor';
const CURSOR_STYLE_ID = 'argo-human-cursor-style';

export interface CursorPoint {
  x: number;
  y: number;
}

export interface HumanCursorOptions {
  /** Stable seed: identical inputs produce identical tutorial motion. */
  seed?: string;
  /** Click-feedback color. */
  accent?: string;
  /** Arrow size after video compression. */
  size?: number;
  /** Initial parking position as viewport fractions. */
  start?: CursorPoint;
}

export interface CursorMoveOptions {
  /** Override the calculated 300–1100 ms movement duration. */
  durationMs?: number;
  /** Point inside the target, where 0/0 is top-left and 1/1 is bottom-right. */
  target?: CursorPoint;
}

export interface CursorClickOptions extends CursorMoveOptions {
  dwellMs?: number;
  holdMs?: number;
  afterMs?: number;
}

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (const character of value) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function random(seed: number): () => number {
  let state = seed;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

const easeInOutCubic = (value: number): number => (value < 0.5 ? 4 * value ** 3 : 1 - (-2 * value + 2) ** 3 / 2);

/**
 * Seeded tutorial variant of CloverLabsAI/human-cursor's curved, distorted, eased trajectory.
 * The seed is intentional: invisible_playwright's movement guidance recommends reproducible paths.
 */
export function buildHumanCursorPath(from: CursorPoint, to: CursorPoint, seed: string, steps: number): CursorPoint[] {
  const count = Math.max(2, steps);
  const next = random(hashSeed(seed));
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const distance = Math.hypot(dx, dy);
  const safeDistance = Math.max(distance, 1);
  const normal = { x: -dy / safeDistance, y: dx / safeDistance };
  const bend = Math.min(96, Math.max(18, distance * 0.13)) * (next() > 0.5 ? 1 : -1) * (0.72 + next() * 0.42);
  const firstControl = { x: from.x + dx * 0.32 + normal.x * bend, y: from.y + dy * 0.32 + normal.y * bend };
  const secondControl = {
    x: from.x + dx * 0.72 + normal.x * bend * 0.7,
    y: from.y + dy * 0.72 + normal.y * bend * 0.7,
  };

  return Array.from({ length: count }, (_, index) => {
    if (index === 0) return { ...from };
    if (index === count - 1) return { ...to };
    const t = easeInOutCubic(index / (count - 1));
    const inverse = 1 - t;
    const distortion = (next() - 0.5) * Math.min(1.4, distance / 180);
    return {
      x:
        inverse ** 3 * from.x +
        3 * inverse ** 2 * t * firstControl.x +
        3 * inverse * t ** 2 * secondControl.x +
        t ** 3 * to.x +
        normal.x * distortion,
      y:
        inverse ** 3 * from.y +
        3 * inverse ** 2 * t * firstControl.y +
        3 * inverse * t ** 2 * secondControl.y +
        t ** 3 * to.y +
        normal.y * distortion,
    };
  });
}

export function movementDurationMs(from: CursorPoint, to: CursorPoint, viewport: CursorPoint): number {
  const normalizedDistance = Math.hypot(to.x - from.x, to.y - from.y) / Math.hypot(viewport.x, viewport.y);
  return Math.round(Math.min(1100, Math.max(300, 300 + 700 * normalizedDistance)));
}

function installOverlay({
  accent,
  cursorId,
  size,
  styleId,
}: {
  accent: string;
  cursorId: string;
  size: number;
  styleId: string;
}): void {
  const previous = document.getElementById(cursorId) as (HTMLDivElement & { __cleanup?: () => void }) | null;
  previous?.__cleanup?.();
  previous?.remove();
  document.getElementById(styleId)?.remove();

  const style = document.createElement('style');
  style.id = styleId;
  style.textContent = `
    @keyframes argo-human-cursor-ripple {
      from { opacity: .75; transform: translate(-50%, -50%) scale(.35); }
      to { opacity: 0; transform: translate(-50%, -50%) scale(2.4); }
    }
    #${cursorId} {
      position: fixed; inset: 0 auto auto 0; z-index: 2147483647; pointer-events: none;
      width: ${size}px; height: ${Math.round(size * 1.3)}px; opacity: 0;
      transform: translate3d(-100px, -100px, 0); will-change: transform;
    }
    #${cursorId}[data-visible='true'] { opacity: 1; }
    #${cursorId} svg { display: block; width: 100%; height: 100%; filter: drop-shadow(0 2px 2px rgb(0 0 0 / .48)); }
    #${cursorId}[data-pressed='true'] svg { transform: scale(.9); transform-origin: 2px 2px; }
    .argo-human-cursor-ripple {
      position: fixed; z-index: 2147483646; pointer-events: none;
      width: 34px; height: 34px; border: 3px solid white; border-radius: 999px;
      box-shadow: 0 0 0 2px ${accent};
      animation: argo-human-cursor-ripple 420ms ease-out forwards;
    }
  `;
  document.head.appendChild(style);

  const cursor = document.createElement('div');
  cursor.id = cursorId;
  cursor.dataset.visible = 'false';
  cursor.dataset.pressed = 'false';
  cursor.setAttribute('aria-hidden', 'true');
  const cursorSvgMarkup = `
    <svg viewBox="0 0 30 39" aria-hidden="true">
      <path d="M2 2L2 30L9.4 23.5L15 36.5L21 33.8L15.4 21H26L2 2Z"
        fill="#fff" stroke="#111827" stroke-width="2.3" stroke-linejoin="round" />
    </svg>
  `;
  // Static, hardcoded SVG literal — no interpolation, nothing user-controlled can reach this sink (CSP audit reviewed).
  cursor.innerHTML = cursorSvgMarkup; // nosemgrep: csp-no-dangerous-html-sinks
  document.body.appendChild(cursor);

  const onMove = (event: MouseEvent): void => {
    cursor.dataset.visible = 'true';
    cursor.style.transform = `translate3d(${event.clientX}px, ${event.clientY}px, 0)`;
  };
  const onDown = (): void => {
    cursor.dataset.pressed = 'true';
  };
  const onUp = (event: MouseEvent): void => {
    cursor.dataset.pressed = 'false';
    const ripple = document.createElement('div');
    ripple.className = 'argo-human-cursor-ripple';
    ripple.style.left = `${event.clientX}px`;
    ripple.style.top = `${event.clientY}px`;
    document.body.appendChild(ripple);
    window.setTimeout(() => ripple.remove(), 450);
  };
  document.addEventListener('mousemove', onMove, true);
  document.addEventListener('mousedown', onDown, true);
  document.addEventListener('mouseup', onUp, true);
  (cursor as HTMLDivElement & { __cleanup?: () => void }).__cleanup = () => {
    document.removeEventListener('mousemove', onMove, true);
    document.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('mouseup', onUp, true);
  };
}

async function setVisible(page: CursorPage, visible: boolean): Promise<void> {
  await page.evaluate(
    ({ id, value }) => {
      const cursor = document.getElementById(id);
      if (cursor) cursor.dataset.visible = String(value);
    },
    { id: CURSOR_ID, value: visible },
  );
}

export async function createArgoHumanCursor(page: CursorPage, options: HumanCursorOptions = {}) {
  const viewport = page.viewportSize() ?? { width: 1920, height: 1080 };
  const seed = options.seed ?? 'argo-human-cursor';
  const start = options.start ?? { x: 0.5, y: 0.5 };
  let position = { x: viewport.width * start.x, y: viewport.height * start.y };
  let movement = 0;
  const overlayOptions = {
    accent: options.accent ?? '#7c3aed',
    cursorId: CURSOR_ID,
    size: options.size ?? 30,
    styleId: CURSOR_STYLE_ID,
  };
  await page.addInitScript(installOverlay, overlayOptions);
  await page.evaluate(installOverlay, overlayOptions);
  await page.mouse.move(position.x, position.y);
  await setVisible(page, true);

  const moveTo = async (target: Locator, moveOptions: CursorMoveOptions = {}): Promise<void> => {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error('Cannot move tutorial cursor to a target without a visible bounding box.');
    const targetPoint = moveOptions.target ?? { x: 0.14, y: 0.7 };
    const destination = {
      x: box.x + box.width * targetPoint.x,
      y: box.y + box.height * targetPoint.y,
    };
    const duration =
      moveOptions.durationMs ?? movementDurationMs(position, destination, { x: viewport.width, y: viewport.height });
    const steps = Math.min(64, Math.max(18, Math.round(duration / 16)));
    const pathSeed = `${seed}:${movement}:${Math.round(destination.x)}:${Math.round(destination.y)}`;
    const path = buildHumanCursorPath(position, destination, pathSeed, steps);
    const cadence = random(hashSeed(`${pathSeed}:cadence`));
    await setVisible(page, true);
    for (const point of path.slice(1)) {
      await page.mouse.move(point.x, point.y);
      await page.waitForTimeout(Math.max(4, (duration / (path.length - 1)) * (0.72 + cadence() * 0.56)));
    }
    position = destination;
    movement += 1;
  };

  return {
    moveTo,
    async click(target: Locator, clickOptions: CursorClickOptions = {}) {
      await moveTo(target, clickOptions);
      await page.waitForTimeout(clickOptions.dwellMs ?? 450);
      await page.mouse.click(position.x, position.y, { delay: clickOptions.holdMs ?? 90 });
      await page.waitForTimeout(clickOptions.afterMs ?? 350);
    },
    async doubleClick(target: Locator, clickOptions: CursorClickOptions = {}) {
      await moveTo(target, clickOptions);
      await page.waitForTimeout(clickOptions.dwellMs ?? 450);
      await page.mouse.dblclick(position.x, position.y, { delay: clickOptions.holdMs ?? 90 });
      await page.waitForTimeout(clickOptions.afterMs ?? 350);
    },
    hide: () => setVisible(page, false),
    async dispose() {
      await page.evaluate(
        ({ cursorId, styleId }) => {
          const cursor = document.getElementById(cursorId) as (HTMLDivElement & { __cleanup?: () => void }) | null;
          cursor?.__cleanup?.();
          cursor?.remove();
          document.getElementById(styleId)?.remove();
          document.querySelectorAll('.argo-human-cursor-ripple').forEach((element) => {
            element.remove();
          });
        },
        { cursorId: CURSOR_ID, styleId: CURSOR_STYLE_ID },
      );
    },
  };
}
