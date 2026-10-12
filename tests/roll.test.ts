import { oklch } from 'culori';
import { describe, expect, it } from 'vitest';
import { colormindBody, rollColormind } from '@/lib/palette/colormind';
import { rollHarmony, seeded } from '@/lib/palette/harmony';

const PALETTE = ['#0c213c', '#071223', '#123459', '#1e4b79', '#39618f', '#6e7b9f', '#999ab9'];
const L = (hex: string) => oklch(hex)!.l;

/** Groups of hues around the colour wheel, a new group wherever the gap to the next hue exceeds 30°. */
function hueClusters(hues: number[]): number {
  if (hues.length < 2) return hues.length;
  const sorted = hues.map((h) => ((h % 360) + 360) % 360).sort((a, b) => a - b);
  const gaps = sorted.map((h, i) => (i === sorted.length - 1 ? sorted[0] + 360 - h : sorted[i + 1] - h));
  return Math.max(1, gaps.filter((g) => g > 30).length);
}

describe('rollHarmony', () => {
  it('keeps locked colours exactly and returns seven hex colours', () => {
    const locked = [true, false, false, true, false, false, false];
    const out = rollHarmony(PALETTE, locked, seeded(1));
    expect(out).toHaveLength(7);
    expect(out[0]).toBe(PALETTE[0]);
    expect(out[3]).toBe(PALETTE[3]);
    for (const hex of out) expect(hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('rolls every colour when nothing is locked (nothing is kept behind your back)', () => {
    const out = rollHarmony(PALETTE, Array(7).fill(false), seeded(2));
    expect(out.filter((c, i) => c !== PALETTE[i]).length).toBeGreaterThanOrEqual(6);
  });

  it('stays cohesive: at most three hue families, and the lightest and darkest stay soft', () => {
    const base = ['#c0392b', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#ecf0f1', '#2c3e50'];
    for (let run = 0; run < 150; run++) {
      const out = rollHarmony(base, [false, false, false, false, false, false, false], seeded(run + 500));
      const lch = out.map((hex) => oklch(hex)!);
      const coloured = lch.filter((c) => (c.c ?? 0) > 0.04);
      expect(hueClusters(coloured.map((c) => c.h ?? 0))).toBeLessThanOrEqual(3);
      const byL = [...lch].sort((x, y) => x.l - y.l);
      expect(byL[0].c ?? 0).toBeLessThan(0.09);
      expect(byL[6].c ?? 0).toBeLessThan(0.09);
    }
  });

  it('returns the palette unchanged when everything is locked', () => {
    expect(rollHarmony(PALETTE, Array(7).fill(true), seeded(3))).toEqual(PALETTE);
  });

  it('always spreads lightness: a light, a dark, and no two colours too close in lightness', () => {
    const base = ['#1e4b79', '#e8c07a', '#000000', '#000000', '#000000', '#000000', '#000000'];
    const locked = [true, true, false, false, false, false, false];
    for (let run = 0; run < 200; run++) {
      const out = rollHarmony(base, locked, seeded(run + 10));
      const ls = out.map(L);
      expect(Math.max(...ls)).toBeGreaterThan(0.85);
      expect(Math.min(...ls)).toBeLessThan(0.3);
      for (let i = 0; i < 7; i++) {
        for (let j = i + 1; j < 7; j++) {
          if (locked[i] && locked[j]) continue;
          expect(Math.abs(ls[i] - ls[j])).toBeGreaterThanOrEqual(0.055);
        }
      }
    }
  });

  it('differs between rolls', () => {
    const locked = [true, false, false, false, false, false, false];
    expect(rollHarmony(PALETTE, locked, seeded(4))).not.toEqual(rollHarmony(PALETTE, locked, seeded(5)));
  });
});

describe('Colormind', () => {
  it('sends locked colours as RGB and the rest as "N", seven slots in two calls', () => {
    const locked = [true, false, true, false, false, true, false];
    const { first, second } = colormindBody(PALETTE, locked);
    expect(first).toEqual({ model: 'default', input: [[12, 33, 60], 'N', [18, 52, 89], 'N', 'N'] });
    const firstResult = ['#0c213c', '#aabbcc', '#123459', '#ddeeff', '#112233'];
    expect(second(firstResult)).toEqual({ model: 'default', input: [[12, 33, 60], [170, 187, 204], [18, 52, 89], [110, 123, 159], 'N'] });
  });

  it('maps two answers onto seven colours and keeps locked ones exact', async () => {
    const answers = [
      { result: [[12, 33, 60], [200, 10, 10], [18, 52, 89], [20, 200, 20], [30, 30, 200]] },
      { result: [[12, 33, 60], [200, 10, 10], [18, 52, 89], [110, 123, 159], [250, 250, 250]] },
    ];
    let call = 0;
    const fetchImpl = (async () => new Response(JSON.stringify(answers[call++]), { status: 200 })) as unknown as typeof fetch;
    const out = await rollColormind(PALETTE, [true, false, true, false, false, true, false], fetchImpl);
    expect(out).toEqual(['#0c213c', '#c80a0a', '#123459', '#14c814', '#1e1ec8', '#6e7b9f', '#fafafa']);
  });

  it('says plainly when Colormind does not answer', async () => {
    const fetchImpl = (async () => {
      throw new Error('ECONNRESET');
    }) as unknown as typeof fetch;
    await expect(rollColormind(PALETTE, Array(7).fill(false), fetchImpl)).rejects.toThrow('Colormind did not answer.');
  });
});
