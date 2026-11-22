type Box = { left: number; right: number; top: number; bottom: number; height: number };

export function tipBottom(tip: Box, dialogs: readonly Box[], viewportHeight: number): number | null | undefined {
  const overlapping = dialogs.filter(
    (dialog) =>
      tip.left < dialog.right && tip.right > dialog.left && tip.top < dialog.bottom && tip.bottom > dialog.top,
  );
  if (!overlapping.length) return undefined;
  const top = Math.min(...overlapping.map((dialog) => dialog.top));
  return top >= tip.height + 16 ? viewportHeight - top + 8 : null;
}
