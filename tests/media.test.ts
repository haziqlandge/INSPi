import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildFrames } from '@/lib/media/collage';
import { ingestImage, MAX_UPLOAD_BYTES, UploadError } from '@/lib/media/ingest';
import { safeMediaPath } from '@/lib/paths';

let dir: string;

const solid = (width: number, height: number, background: string) =>
  sharp({ create: { width, height, channels: 3, background } }).png().toBuffer();

async function decode(dataUrl: string) {
  expect(dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
  return sharp(Buffer.from(dataUrl.split(',')[1], 'base64')).metadata();
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'inspi-media-'));
});

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('ingestImage', () => {
  it('stores a web-sized WebP and a thumbnail, and reports size and colour', async () => {
    const image = await ingestImage(await solid(3000, 1500, '#cc3311'), dir);
    expect(image.width).toBe(2000);
    expect(image.height).toBe(1000);
    expect(image.placeholder.toLowerCase()).toBe('#cc3311');
    expect(image.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(existsSync(join(dir, `${image.id}.webp`))).toBe(true);
    const thumb = await sharp(join(dir, `${image.id}.thumb.webp`)).metadata();
    expect(thumb.width).toBe(720);
  });

  it('does not enlarge small images', async () => {
    const image = await ingestImage(await solid(300, 200, '#224466'), dir);
    expect([image.width, image.height]).toEqual([300, 200]);
  });

  it('rejects files that are not images, are empty, or are too large', async () => {
    await expect(ingestImage(Buffer.from('<html>not an image</html>'), dir)).rejects.toBeInstanceOf(UploadError);
    await expect(ingestImage(Buffer.alloc(0), dir)).rejects.toThrow(/empty/);
    await expect(ingestImage(Buffer.alloc(MAX_UPLOAD_BYTES + 1), dir)).rejects.toThrow(/20 MB/);
  });
});

describe('buildFrames', () => {
  it('sends a lone image as itself and collages a group onto one sheet', async () => {
    const tall = await ingestImage(await solid(800, 1200, '#aa0000'), dir);
    const tall2 = await ingestImage(await solid(900, 1200, '#00aa00'), dir);
    const wide = await ingestImage(await solid(1600, 800, '#0000aa'), dir);
    const wide2 = await ingestImage(await solid(1600, 900, '#aaaa00'), dir);
    const images = [tall, tall2, wide, wide2];

    const frames = await buildFrames(dir, images, [[0], [0, 1], [2, 3]]);
    expect(frames.map((f) => f.images)).toEqual([1, 2, 2]);

    const lone = await decode(frames[0].dataUrl);
    expect([lone.width, lone.height]).toEqual([800, 1200]);

    // two tall images sit side by side: the sheet is wider than either
    const sideBySide = await decode(frames[1].dataUrl);
    expect(sideBySide.width!).toBeGreaterThan(sideBySide.height!);
    expect(Math.max(sideBySide.width!, sideBySide.height!)).toBeLessThanOrEqual(1568);

    // two wide images stack: the sheet is taller than it is wide
    const stacked = await decode(frames[2].dataUrl);
    expect(stacked.height!).toBeGreaterThan(stacked.width! * 0.9);
    expect(Math.max(stacked.width!, stacked.height!)).toBeLessThanOrEqual(1568);
  });
});

describe('safeMediaPath', () => {
  it('only resolves paths inside the media folder', () => {
    expect(safeMediaPath(['abc', 'img.webp'])).toMatch(/media[\\/]abc[\\/]img\.webp$/);
    expect(safeMediaPath(['..', 'inspi.db'])).toBeNull();
    expect(safeMediaPath(['abc', '..', '..', '.env'])).toBeNull();
    expect(safeMediaPath(['a/b', 'img.webp'])).toBeNull();
    expect(safeMediaPath(['C:', 'Windows'])).toBeNull();
    expect(safeMediaPath([])).toBeNull();
  });
});
