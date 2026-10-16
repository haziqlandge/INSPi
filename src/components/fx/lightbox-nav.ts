// What the zoom view (PrintLightbox) does with a key, a swipe or a position in its list.
// Plain functions, so they are tested without a browser.

/** The previous and next positions, or null where the list ends. */
export function neighbours(index: number, count: number): { prev: number | null; next: number | null } {
  return { prev: index > 0 ? index - 1 : null, next: index < count - 1 ? index + 1 : null };
}

/** Escape closes; the arrow keys move when there is somewhere to go; anything else is not ours. */
export function keyAction(key: string, index: number, count: number): { close: true } | { index: number } | null {
  if (key === 'Escape') return { close: true };
  const { prev, next } = neighbours(index, count);
  if (key === 'ArrowLeft' && prev !== null) return { index: prev };
  if (key === 'ArrowRight' && next !== null) return { index: next };
  return null;
}

/** A pointer that moved this far sideways, and less up or down, is a swipe: 1 = next, -1 = previous. */
export function swipeStep(dx: number, dy: number, threshold = 50): -1 | 0 | 1 {
  if (Math.abs(dx) < threshold || Math.abs(dy) > Math.abs(dx)) return 0;
  return dx < 0 ? 1 : -1;
}
