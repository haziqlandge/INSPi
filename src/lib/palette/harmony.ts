import { clampChroma, formatHex, oklch, type Oklch } from 'culori';

/**
 * "Roll" for a palette, worked out locally. Good palettes are mostly one hue family in several
 * lightnesses, with colour carried by the mid-tones and the lights and darks softly tinted, plus at
 * most one second hue as an accent. So: the colours you locked stay; the rest are built around one
 * main hue (your most colourful locked colour, or, with nothing locked, the image's most colourful
 * main colour, used as inspiration only), spread in lightness so the palette always has a light, a
 * dark and no two colours of nearly the same lightness.
 */

/** Small deterministic generator, so a roll can be repeated in tests. */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The second hue, if any, relative to the main one: monochrome, analogous, complementary, split, triad. */
const SECOND_HUE: (number | null)[] = [null, 30, -30, 180, 150, 210, 120];

/**
 * Lightness steps 0.065 apart: any two different steps are already far enough apart, so picking
 * distinct steps is enough to keep every pair distinguishable.
 */
const STEP = 0.065;
const LIGHTNESS = Array.from({ length: 14 }, (_, i) => Math.round((0.11 + i * STEP) * 1000) / 1000);
const LIGHT = 0.85;
const DARK = 0.3;

function shuffle<T>(items: T[], rand: () => number): T[] {
  const out = [...items];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Lightness values for `count` new colours, around the ones already taken by locked colours. */
function pickLightness(count: number, taken: number[], rand: () => number): number[] {
  const free = LIGHTNESS.filter((l) => taken.every((t) => Math.abs(l - t) >= STEP));
  const chosen: number[] = [];
  const take = (pool: number[]) => {
    const options = shuffle(pool.filter((l) => !chosen.includes(l)), rand);
    if (options.length) chosen.push(options[0]);
  };
  if (count > 0 && !taken.some((l) => l > LIGHT)) take(free.filter((l) => l > LIGHT));
  if (chosen.length < count && !taken.some((l) => l < DARK)) take(free.filter((l) => l < DARK));
  while (chosen.length < count) {
    const before = chosen.length;
    take(free);
    // Every step is in use (six or more colours locked across the range): reuse the widest gap.
    if (chosen.length === before) chosen.push(0.11 + rand() * 0.86);
  }
  return shuffle(chosen, rand);
}

export function rollHarmony(colors: string[], locked: boolean[], rand: () => number = Math.random): string[] {
  if (locked.every(Boolean)) return [...colors];

  const parsed = colors.map((hex) => oklch(hex));
  const anchors = parsed.filter((c, i): c is Oklch => Boolean(c) && locked[i]);
  // Nothing locked: the image's biggest colours inspire the roll, but every colour is replaced.
  const pool = anchors.length ? anchors : parsed.slice(0, 3).filter((c): c is Oklch => Boolean(c));
  const inspiration = pool.reduce<Oklch | undefined>((best, c) => ((c.c ?? 0) > (best?.c ?? -1) ? c : best), undefined);
  const mainHue = inspiration && (inspiration.c ?? 0) > 0.02 && inspiration.h !== undefined ? inspiration.h : rand() * 360;
  const chromas = pool.map((c) => c.c ?? 0).sort((x, y) => x - y);
  const median = chromas.length ? chromas[Math.floor(chromas.length / 2)] : 0.12;
  const baseChroma = Math.min(0.18, Math.max(0.06, median)) * (0.85 + rand() * 0.3);
  const second = SECOND_HUE[Math.floor(rand() * SECOND_HUE.length)];

  const open = colors.map((_, i) => i).filter((i) => !locked[i]);
  const lightness = pickLightness(open.length, anchors.map((c) => c.l), rand);

  // The lightest and darkest new colours play background and text: tinted neutrals.
  const lightest = Math.max(...lightness);
  const darkest = Math.min(...lightness);
  const out = [...colors];
  open.forEach((slot, k) => {
    const l = lightness[k];
    const neutral = open.length > 2 && (l === lightest || l === darkest);
    // Colour peaks in the mid-tones and fades towards white and black, as in real palettes.
    const envelope = Math.sin(Math.PI * l) ** 1.5;
    const chroma = neutral ? Math.min(0.06, baseChroma * 0.3) : baseChroma * (0.25 + 0.75 * envelope);
    const accent = !neutral && second !== null && l > 0.4 && l < 0.8 && rand() < 0.5;
    const hue = (mainHue + (accent ? second : 0) + (rand() - 0.5) * 10 + 360) % 360;
    out[slot] = formatHex(clampChroma({ mode: 'oklch', l, c: chroma, h: hue }, 'oklch'));
  });
  return out;
}
