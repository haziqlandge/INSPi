import { describe, expect, it } from 'vitest';
// The audit runs in the page (imported from /dev/ui-audit.js); its arithmetic is plain functions.
import { blend, contrastRatio, nearEdge, parseColor } from '../public/dev/ui-audit.js';

describe('ui-audit helpers', () => {
  it('reads computed colours, with their alpha', () => {
    expect(parseColor('rgb(25, 17, 19)')).toEqual([25, 17, 19, 1]);
    expect(parseColor('rgba(246, 217, 190, 0.5)')).toEqual([246, 217, 190, 0.5]);
    expect(parseColor('transparent')).toEqual([0, 0, 0, 0]);
  });

  it('gives WCAG contrast ratios', () => {
    expect(contrastRatio([0, 0, 0, 1], [255, 255, 255, 1])).toBeCloseTo(21, 1);
    // The dark-mode bug: cream text on a cream fill
    expect(contrastRatio([246, 217, 190, 1], [246, 217, 190, 1])).toBeCloseTo(1, 5);
  });

  it('lays a translucent colour over what is behind it', () => {
    expect(blend([255, 255, 255, 0.5], [0, 0, 0, 1])).toEqual([128, 128, 128, 1]);
  });

  it('flags a rect that leaves the viewport or comes within the margin of an edge', () => {
    const view = { width: 1280, height: 720 };
    expect(nearEdge({ left: 20, top: 20, right: 1260, bottom: 700 }, view, 16)).toBe(false);
    expect(nearEdge({ left: 8, top: 20, right: 600, bottom: 400 }, view, 16)).toBe(true);
    expect(nearEdge({ left: 100, top: 100, right: 1300, bottom: 400 }, view, 16)).toBe(true);
  });
});
