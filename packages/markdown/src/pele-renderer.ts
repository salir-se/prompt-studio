import type { DiagramRenderer } from './diagram-renderer';

// Landing v6 palette. The SVG is isolated as an image, so it carries its own theme.
const landingTheme = [
  'color-scheme:light dark',
  '--pele-bg:light-dark(#ffffff,#080b3a)',
  '--pele-fg:light-dark(#080b3a,#f8f7ff)',
  '--pele-muted:light-dark(#5f6076,#cdc9dd)',
  '--pele-surface:light-dark(#f4f1ff,#17154a)',
  '--pele-surface-alt:light-dark(#e8e1ff,#554b89)',
  '--pele-line:light-dark(#7047ff,#a98cff)',
  '--pele-border:light-dark(#7047ff,#a98cff)',
  '--pele-accent:light-dark(#7047ff,#a98cff)',
  '--pele-radius:10px',
  'background-color:var(--pele-bg)',
].join(';');

export const peleRenderer: DiagramRenderer = async (source) => {
  const { renderAsync } = await import('pele/lazy');
  const { svg } = await renderAsync(source, { links: false, images: false, now: 0 });
  return svg.replace(/^(<svg\b[^>]*\bstyle=")/, '$1' + landingTheme + ';');
};
