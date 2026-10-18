import { describe, expect, it } from 'vitest';
import { placePopover } from '@/components/ui/place-popover';

const view = { width: 1280, height: 720 };
const anchor = (left: number, top: number, width = 120, height = 36) => ({ left, top, right: left + width, bottom: top + height });

describe('placing a popover beside its button', () => {
  it('opens below when there is room, aligned to the button', () => {
    expect(placePopover(anchor(100, 200), { width: 320, height: 300 }, view)).toEqual({ top: 244, left: 100, width: 320, maxHeight: 460, side: 'below' });
  });

  it('opens above when only above has room', () => {
    const p = placePopover(anchor(100, 600), { width: 320, height: 300 }, view);
    expect(p.side).toBe('above');
    expect(p.top).toBe(600 - 8 - 300);
  });

  it('takes the roomier side and scrolls inside when neither fits', () => {
    const p = placePopover(anchor(100, 300), { width: 320, height: 900 }, view);
    expect(p.side).toBe('below');
    expect(p.maxHeight).toBe(720 - 344 - 16);
    expect(p.top + p.maxHeight).toBeLessThanOrEqual(720 - 16);
  });

  it('shifts sideways to stay on screen and never grows wider than it', () => {
    expect(placePopover(anchor(1200, 200), { width: 320, height: 200 }, view).left).toBe(1280 - 16 - 320);
    expect(placePopover(anchor(10, 200), { width: 400, height: 200 }, { width: 375, height: 812 })).toMatchObject({ left: 16, width: 343 });
  });
});
