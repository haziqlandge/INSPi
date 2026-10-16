// The Renders carousel's rules (RenderCarousel in library.tsx), as plain functions tested without a browser.

/** Autoplay moves one print this often, exactly as the next arrow does. */
export const AUTOPLAY_MS = 4000;
/** After the person last touched the carousel, autoplay waits this long before it moves again. */
export const RESUME_MS = 6000;

/** The print one step away, or null past either end (the arrows do not wrap). */
export function stepIndex(current: number, count: number, dir: 1 | -1): number | null {
  const next = current + dir;
  return next < 0 || next >= count ? null : next;
}

/** The print whose left edge is at (or just before) the scroll position. */
export function indexAt(scrollLeft: number, starts: number[]): number {
  let index = 0;
  starts.forEach((start, i) => {
    if (start <= scrollLeft + 4) index = i;
  });
  return index;
}

/** Where autoplay goes next: one print on, or back to the first once the end is in view. */
export function autoplayTarget(current: number, count: number, atEnd: boolean): number {
  return atEnd ? 0 : (stepIndex(current, count, 1) ?? 0);
}

export interface AutoplayState {
  hovering: boolean;
  focused: boolean;
  dragging: boolean;
  zoomed: boolean;
  hidden: boolean;
  offscreen: boolean;
  reducedMotion: boolean;
  /** Everything fits, so there is nothing to move to. */
  fits: boolean;
  /** Since the person last touched it. */
  idleMs: number;
}

/** Autoplay moves only when nobody is looking at, holding or zoomed into it, and it is on screen. */
export function canAutoplay(s: AutoplayState): boolean {
  return !s.hovering && !s.focused && !s.dragging && !s.zoomed && !s.hidden && !s.offscreen && !s.reducedMotion && !s.fits && s.idleMs >= RESUME_MS;
}
