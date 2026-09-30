import { describe, expect, it } from 'vitest';
import { MAX_IMAGES_COMPRESSED, MAX_IMAGES_PLAIN, packFrames } from '@/lib/media/pack';

const sizes = (groups: number[][]) => groups.map((g) => g.length);

describe('packFrames', () => {
  it('sends each image as its own frame in plain mode', () => {
    expect(packFrames(1, false)).toEqual([[0]]);
    expect(packFrames(3, false)).toEqual([[0], [1], [2]]);
  });

  it('refuses more than three images in plain mode', () => {
    expect(() => packFrames(MAX_IMAGES_PLAIN + 1, false)).toThrow(/compress/i);
  });

  it('collages into groups as close to three as possible', () => {
    expect(sizes(packFrames(1, true))).toEqual([1]);
    expect(sizes(packFrames(2, true))).toEqual([2]);
    expect(sizes(packFrames(3, true))).toEqual([3]);
    expect(sizes(packFrames(4, true))).toEqual([2, 2]);
    expect(sizes(packFrames(5, true))).toEqual([3, 2]);
    expect(sizes(packFrames(6, true))).toEqual([3, 3]);
    expect(sizes(packFrames(7, true))).toEqual([3, 2, 2]);
    expect(sizes(packFrames(8, true))).toEqual([3, 3, 2]);
    expect(sizes(packFrames(9, true))).toEqual([3, 3, 3]);
  });

  it('keeps images in upload order and uses each exactly once', () => {
    expect(packFrames(5, true)).toEqual([[0, 1, 2], [3, 4]]);
    expect(packFrames(7, true).flat()).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('rejects empty and oversized sets', () => {
    expect(() => packFrames(0, true)).toThrow();
    expect(() => packFrames(MAX_IMAGES_COMPRESSED + 1, true)).toThrow(/9/);
  });
});
