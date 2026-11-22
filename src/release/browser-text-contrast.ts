import type { Locator } from '@playwright/test';

/** Sample composited browser colors, including OKLCH tokens and translucent ancestor surfaces. */
export function textContrast(element: Locator): Promise<number> {
  return element.evaluate((node) => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    const context = canvas.getContext('2d')!;
    const ancestors: Element[] = [];
    for (let parent: Element | null = node; parent; parent = parent.parentElement) ancestors.unshift(parent);
    context.fillStyle = '#fff';
    context.fillRect(0, 0, 1, 1);
    for (const parent of ancestors) {
      context.fillStyle = getComputedStyle(parent).backgroundColor;
      context.fillRect(0, 0, 1, 1);
    }
    function luminance() {
      const rgb = Array.from(context.getImageData(0, 0, 1, 1).data).slice(0, 3);
      const linear = rgb.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
    }
    const background = luminance();
    context.fillStyle = getComputedStyle(node).color;
    context.fillRect(0, 0, 1, 1);
    const foreground = luminance();
    return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
  });
}
