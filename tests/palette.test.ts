import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deltaE, extractPalette, hexToOklab } from '@/lib/media/palette';

const SEVEN = ['#c0392b', '#f1c40f', '#27ae60', '#2980b9', '#8e44ad', '#ecf0f1', '#2c3e50'];
let dir: string;

/** Vertical stripes, one per colour, equal widths. */
async function stripes(colors: string[], file: string, width = 280, height = 120): Promise<string> {
  const stripe = Math.floor(width / colors.length);
  const layers = await Promise.all(
    colors.map(async (color, i) => ({
      input: await sharp({ create: { width: stripe, height, channels: 3, background: color } }).png().toBuffer(),
      left: i * stripe,
      top: 0,
    })),
  );
  const path = join(dir, file);
  writeFileSync(path, await sharp({ create: { width: stripe * colors.length, height, channels: 3, background: '#000' } }).composite(layers).webp({ lossless: true }).toBuffer());
  return path;
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'inspi-palette-'));
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('extractPalette', () => {
  it('finds seven distinct colours close to the ones in the image, with shares summing to one', async () => {
    const palette = await extractPalette([await stripes(SEVEN, 'seven.webp')]);
    expect(palette).toHaveLength(7);
    for (const source of SEVEN) {
      const nearest = Math.min(...palette.map((p) => deltaE(hexToOklab(p.hex), hexToOklab(source))));
      expect(nearest).toBeLessThan(0.02);
    }
    expect(palette.reduce((sum, p) => sum + p.share, 0)).toBeCloseTo(1, 3);
    for (const p of palette) expect(p.hex).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('orders colours by share, biggest first', async () => {
    const palette = await extractPalette([await stripes(['#111111', '#111111', '#111111', '#eeeeee'], 'shares.webp')]);
    expect(palette[0].share).toBeGreaterThan(palette[palette.length - 1].share);
    expect(deltaE(hexToOklab(palette[0].hex), hexToOklab('#111111'))).toBeLessThan(0.02);
  });

  it('returns only as many colours as the image has', async () => {
    const palette = await extractPalette([await stripes(['#ff0000', '#0000ff'], 'two.webp')]);
    expect(palette).toHaveLength(2);
  });

  it('copes with a 1×1 image and a fully transparent one', async () => {
    const tiny = join(dir, 'tiny.png');
    writeFileSync(tiny, await sharp({ create: { width: 1, height: 1, channels: 3, background: '#336699' } }).png().toBuffer());
    expect(await extractPalette([tiny])).toHaveLength(1);
    const clear = join(dir, 'clear.png');
    writeFileSync(clear, await sharp({ create: { width: 20, height: 20, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } }).png().toBuffer());
    expect(await extractPalette([clear])).toEqual([]);
  });

  it('gives the same answer twice', async () => {
    const path = join(__dirname, '..', 'test-images', 'art-starry-night.jpg');
    const first = await extractPalette([path]);
    const second = await extractPalette([path]);
    expect(first).toEqual(second);
    expect(first).toHaveLength(7);
  });

  it('weighs several images equally', async () => {
    const a = await stripes(['#ff0000'], 'a.webp', 400, 400);
    const b = await stripes(['#0000ff'], 'b.webp', 40, 40);
    const palette = await extractPalette([a, b]);
    expect(palette.map((p) => p.share)).toEqual([0.5, 0.5]);
  });
});

describe('backfillPalettes', () => {
  it('measures entries that have no palette yet and skips the rest', async () => {
    const { openLibrary } = await import('@/lib/store/library');
    const { backfillPalettes } = await import('@/lib/media/entry-palette');
    const data = mkdtempSync(join(tmpdir(), 'inspi-backfill-'));
    const previous = process.env.INSPI_DATA_DIR;
    process.env.INSPI_DATA_DIR = data;
    const lib = openLibrary(data);
    try {
      const entry = lib.createEntry({ mode: 'web', compress: false, images: [{ id: 'imgA', width: 8, height: 8, bytes: 1, placeholder: '#000', sha256: 'x' }] });
      const { mkdirSync } = await import('node:fs');
      mkdirSync(join(data, 'media', entry.id), { recursive: true });
      writeFileSync(join(data, 'media', entry.id, 'imgA.webp'), await sharp({ create: { width: 8, height: 8, channels: 3, background: '#3366cc' } }).webp({ lossless: true }).toBuffer());
      expect(await backfillPalettes(lib, 10)).toBe(1);
      expect(lib.getEntry(entry.id)!.palette![0].hex).toBe('#3366cc');
      expect(await backfillPalettes(lib, 10)).toBe(0);
    } finally {
      lib.close();
      process.env.INSPI_DATA_DIR = previous;
      rmSync(data, { recursive: true, force: true });
    }
  });

  it('marks an entry whose image files are missing with an empty palette instead of retrying forever', async () => {
    const { openLibrary } = await import('@/lib/store/library');
    const { backfillPalettes } = await import('@/lib/media/entry-palette');
    const data = mkdtempSync(join(tmpdir(), 'inspi-backfill-'));
    const previous = process.env.INSPI_DATA_DIR;
    process.env.INSPI_DATA_DIR = data;
    const lib = openLibrary(data);
    try {
      const entry = lib.createEntry({ mode: 'web', compress: false, images: [{ id: 'gone', width: 8, height: 8, bytes: 1, placeholder: '#000', sha256: 'x' }] });
      expect(await backfillPalettes(lib, 10)).toBe(1);
      expect(lib.getEntry(entry.id)!.palette).toEqual([]);
      expect(lib.entriesWithoutPalette(10)).toEqual([]);
    } finally {
      lib.close();
      process.env.INSPI_DATA_DIR = previous;
      rmSync(data, { recursive: true, force: true });
    }
  });
});
