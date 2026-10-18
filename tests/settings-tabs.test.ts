import { describe, expect, it } from 'vitest';
import { tabFrom } from '@/components/settings/tabs';
import { arrowTarget } from '@/components/ui/segmented-keys';

describe('settings tabs', () => {
  it('opens on the tab the address names, Analysis otherwise', () => {
    expect(tabFrom('?tab=mcp')).toBe('mcp');
    expect(tabFrom('?tab=visualize&x=1')).toBe('visualize');
    expect(tabFrom('?tab=nope')).toBe('analysis');
    expect(tabFrom('')).toBe('analysis');
  });
});

describe('arrow keys on a segmented switch', () => {
  const values = ['analysis', 'visualize', 'mcp'];
  it('moves to the next or previous choice and wraps at the ends', () => {
    expect(arrowTarget(values, 'analysis', 'ArrowRight')).toBe('visualize');
    expect(arrowTarget(values, 'mcp', 'ArrowRight')).toBe('analysis');
    expect(arrowTarget(values, 'analysis', 'ArrowLeft')).toBe('mcp');
    expect(arrowTarget(values, 'visualize', 'Home')).toBe('analysis');
    expect(arrowTarget(values, 'visualize', 'End')).toBe('mcp');
    expect(arrowTarget(values, 'visualize', 'Enter')).toBeNull();
  });
});
