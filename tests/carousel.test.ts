import { describe, expect, it } from 'vitest';
import { AUTOPLAY_MS, RESUME_MS, autoplayTarget, canAutoplay, indexAt, stepIndex } from '@/components/fx/carousel-nav';

describe('renders carousel', () => {
  it('steps one print at a time, and the arrows stop at the ends', () => {
    expect(stepIndex(0, 5, 1)).toBe(1);
    expect(stepIndex(4, 5, 1)).toBeNull();
    expect(stepIndex(0, 5, -1)).toBeNull();
    expect(stepIndex(3, 5, -1)).toBe(2);
  });

  it('knows which print is at the left edge', () => {
    const starts = [0, 330, 660, 990];
    expect(indexAt(0, starts)).toBe(0);
    expect(indexAt(332, starts)).toBe(1);
    expect(indexAt(500, starts)).toBe(1);
    expect(indexAt(5000, starts)).toBe(3);
  });

  it('autoplays like the next arrow, and glides back to the first print from the end', () => {
    expect(autoplayTarget(1, 5, false)).toBe(2);
    expect(autoplayTarget(2, 5, true)).toBe(0);
    expect(autoplayTarget(4, 5, false)).toBe(0);
  });

  it('waits while anyone is looking, dragging, zoomed in, away, or asked for less motion', () => {
    const calm = { hovering: false, focused: false, dragging: false, zoomed: false, hidden: false, offscreen: false, reducedMotion: false, fits: false, idleMs: RESUME_MS };
    expect(canAutoplay(calm)).toBe(true);
    for (const key of ['hovering', 'focused', 'dragging', 'zoomed', 'hidden', 'offscreen', 'reducedMotion', 'fits'] as const) {
      expect(canAutoplay({ ...calm, [key]: true })).toBe(false);
    }
    expect(canAutoplay({ ...calm, idleMs: RESUME_MS - 1 })).toBe(false);
    expect(AUTOPLAY_MS).toBe(4000);
  });
});
