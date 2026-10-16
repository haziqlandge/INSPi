import { describe, expect, it } from 'vitest';
import { keyAction, neighbours, swipeStep } from '@/components/fx/lightbox-nav';

describe('zoom view navigation', () => {
  it('offers a neighbour only where one exists', () => {
    expect(neighbours(0, 1)).toEqual({ prev: null, next: null });
    expect(neighbours(0, 3)).toEqual({ prev: null, next: 1 });
    expect(neighbours(1, 3)).toEqual({ prev: 0, next: 2 });
    expect(neighbours(2, 3)).toEqual({ prev: 1, next: null });
  });

  it('maps keys to closing or moving, and ignores a move with nowhere to go', () => {
    expect(keyAction('Escape', 1, 3)).toEqual({ close: true });
    expect(keyAction('ArrowRight', 1, 3)).toEqual({ index: 2 });
    expect(keyAction('ArrowLeft', 1, 3)).toEqual({ index: 0 });
    expect(keyAction('ArrowLeft', 0, 3)).toBeNull();
    expect(keyAction('ArrowRight', 2, 3)).toBeNull();
    expect(keyAction('Enter', 1, 3)).toBeNull();
  });

  it('reads a horizontal swipe past the threshold as a step, and a tap or a scroll as none', () => {
    expect(swipeStep(-80, 6)).toBe(1);
    expect(swipeStep(90, -4)).toBe(-1);
    expect(swipeStep(20, 0)).toBe(0);
    expect(swipeStep(-80, 120)).toBe(0);
  });
});
