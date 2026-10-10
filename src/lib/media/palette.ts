import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import type { PaletteSwatch } from '../types';

/**
 * The colours an image is actually made of, measured rather than guessed: k-means in OKLab (where
 * distance matches how different colours look), weighted so several images count equally.
 */

type Lab = [number, number, number];

const SAMPLE_EDGE = 96;
const ITERATIONS = 12;
/** Two colours closer than this look the same; one of them is replaced by something new. */
const SAME = 0.03;
const SEED = 7;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const toLinear = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGamma = (c: number) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export function rgbToOklab(r: number, g: number, b: number): Lab {
  const lr = toLinear(r / 255);
  const lg = toLinear(g / 255);
  const lb = toLinear(b / 255);
  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

export function oklabToHex([L, a, b]: Lab): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const rgb = [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
  return `#${rgb
    .map((c) => Math.round(Math.min(1, Math.max(0, toGamma(c))) * 255).toString(16).padStart(2, '0'))
    .join('')}`;
}

export function hexToOklab(hex: string): Lab {
  const n = Number.parseInt(hex.replace('#', ''), 16);
  return rgbToOklab((n >> 16) & 255, (n >> 8) & 255, n & 255);
}

export function deltaE(x: Lab, y: Lab): number {
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
}

interface Sample {
  points: Lab[];
  weights: number[];
}

async function sample(files: string[]): Promise<Sample> {
  const perFile: Lab[][] = [];
  for (const file of files) {
    // Read into memory first: sharp holds files open on Windows, which would block deleting the entry.
    const { data, info } = await sharp(await readFile(file))
      .resize(SAMPLE_EDGE, SAMPLE_EDGE, { fit: 'inside', withoutEnlargement: true })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const points: Lab[] = [];
    for (let i = 0; i < info.width * info.height; i++) {
      const o = i * 4;
      if (data[o + 3] < 128) continue; // transparent pixels are not part of the look
      points.push(rgbToOklab(data[o], data[o + 1], data[o + 2]));
    }
    if (points.length) perFile.push(points);
  }
  // Each image carries the same total weight, whatever its size.
  const points = perFile.flat();
  const weights = perFile.flatMap((ps) => ps.map(() => 1 / (ps.length * perFile.length)));
  return { points, weights };
}

function nearest(point: Lab, centres: Lab[]): { index: number; distance: number } {
  let index = 0;
  let distance = Infinity;
  centres.forEach((c, i) => {
    const d = deltaE(point, c);
    if (d < distance) {
      distance = d;
      index = i;
    }
  });
  return { index, distance };
}

/** k-means++ seeding: each new centre is picked with odds that grow with distance from the others. */
function seed({ points, weights }: Sample, k: number, rand: () => number): Lab[] {
  const pick = (scores: number[]) => {
    const total = scores.reduce((a, b) => a + b, 0);
    let r = rand() * total;
    for (let i = 0; i < scores.length; i++) {
      r -= scores[i];
      if (r <= 0) return i;
    }
    return scores.length - 1;
  };
  const centres: Lab[] = [points[pick(weights)]];
  while (centres.length < k) {
    const scores = points.map((p, i) => weights[i] * nearest(p, centres).distance ** 2);
    if (scores.every((s) => s === 0)) break;
    centres.push(points[pick(scores)]);
  }
  return centres;
}

function lloyd({ points, weights }: Sample, centres: Lab[], rounds: number): { centres: Lab[]; mass: number[] } {
  let mass: number[] = [];
  for (let round = 0; round < rounds; round++) {
    const sums = centres.map((): Lab => [0, 0, 0]);
    mass = centres.map(() => 0);
    points.forEach((p, i) => {
      const { index } = nearest(p, centres);
      const w = weights[i];
      sums[index][0] += p[0] * w;
      sums[index][1] += p[1] * w;
      sums[index][2] += p[2] * w;
      mass[index] += w;
    });
    centres = centres.map((c, i) => (mass[i] > 0 ? [sums[i][0] / mass[i], sums[i][1] / mass[i], sums[i][2] / mass[i]] : c));
  }
  return { centres, mass };
}

/** Distinct colours present, after rounding away noise; caps k for flat images. */
function distinctCount(points: Lab[], cap: number): number {
  const seen = new Set<string>();
  for (const p of points) {
    seen.add(`${Math.round(p[0] * 100)},${Math.round(p[1] * 100)},${Math.round(p[2] * 100)}`);
    if (seen.size >= cap) return cap;
  }
  return seen.size;
}

/** Up to `k` colours from the images, biggest share first. Shares sum to 1. */
export async function extractPalette(files: string[], k = 7): Promise<PaletteSwatch[]> {
  const data = await sample(files);
  if (!data.points.length) return [];
  const want = Math.min(k, distinctCount(data.points, k));
  const rand = mulberry32(SEED);
  let { centres, mass } = lloyd(data, seed(data, want, rand), ITERATIONS);

  // Centres that landed on the same colour: drop one and seed a replacement where the fit is worst.
  for (let pass = 0; pass < 3; pass++) {
    const twin = centres.findIndex((c, i) => centres.some((o, j) => j < i && deltaE(c, o) < SAME));
    if (twin < 0) break;
    centres = centres.filter((_, i) => i !== twin);
    let worst = -1;
    let worstDistance = SAME;
    data.points.forEach((p, i) => {
      const d = nearest(p, centres).distance;
      if (d > worstDistance) {
        worstDistance = d;
        worst = i;
      }
    });
    if (worst >= 0) centres.push(data.points[worst]);
    ({ centres, mass } = lloyd(data, centres, ITERATIONS / 2));
  }

  const total = mass.reduce((a, b) => a + b, 0);
  return centres
    .map((c, i) => ({ hex: oklabToHex(c), share: Math.round((mass[i] / total) * 10_000) / 10_000 }))
    .filter((swatch) => swatch.share > 0)
    .sort((a, b) => b.share - a.share);
}
