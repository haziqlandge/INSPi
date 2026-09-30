import { join } from 'node:path';
import sharp, { type OverlayOptions, type Sharp } from 'sharp';
import type { Frame } from '../ai/strategy';

// Without this, sharp keeps image files open on Windows and they cannot be deleted afterwards.
sharp.cache({ files: 0 });

/** Longest edge of what is sent to the model. Larger adds upload weight without adding tokens. */
const FRAME_EDGE = 1568;
const GUTTER = 14;
const GROUND = '#808080';
const LABELS = ['A', 'B', 'C'];

interface Cell {
  file: string;
  width: number;
  height: number;
}

async function toDataUrl(image: Sharp): Promise<string> {
  const jpeg = await image.flatten({ background: '#ffffff' }).jpeg({ quality: 84, mozjpeg: true }).toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

async function single(file: string): Promise<string> {
  return toDataUrl(sharp(file).resize({ width: FRAME_EDGE, height: FRAME_EDGE, fit: 'inside', withoutEnlargement: true }));
}

function label(letter: string): Buffer {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="44" height="44">
      <rect width="44" height="44" rx="8" fill="#000" fill-opacity="0.72"/>
      <text x="22" y="31" font-family="Arial, Helvetica, sans-serif" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">${letter}</text>
    </svg>`,
  );
}

/**
 * Lays 2–3 images on one neutral sheet: side by side when they are tall, stacked when they are wide,
 * each keeping its proportions, with a corner letter so the model can refer to a cell.
 */
async function sheet(cells: Cell[]): Promise<string> {
  const wide = cells.reduce((sum, c) => sum + c.width / c.height, 0) / cells.length >= 1.15;

  // Give every cell the same width (stacked) or height (side by side), then scale the sheet to fit.
  const unit = 1000;
  const sized = cells.map((c) =>
    wide ? { ...c, w: unit, h: (unit * c.height) / c.width } : { ...c, w: (unit * c.width) / c.height, h: unit },
  );
  const rawW = wide ? unit : sized.reduce((s, c) => s + c.w, 0);
  const rawH = wide ? sized.reduce((s, c) => s + c.h, 0) : unit;
  const gaps = GUTTER * (cells.length + 1);
  const scale = Math.min((FRAME_EDGE - (wide ? 2 * GUTTER : gaps)) / rawW, (FRAME_EDGE - (wide ? gaps : 2 * GUTTER)) / rawH);

  let cursor = GUTTER;
  const layers: OverlayOptions[] = [];
  let maxCross = 0;
  for (const [i, c] of sized.entries()) {
    const w = Math.max(1, Math.round(c.w * scale));
    const h = Math.max(1, Math.round(c.h * scale));
    const left = wide ? GUTTER : cursor;
    const top = wide ? cursor : GUTTER;
    const input = await sharp(c.file).resize(w, h, { fit: 'fill' }).flatten({ background: '#ffffff' }).toBuffer();
    layers.push({ input, left, top }, { input: label(LABELS[i]), left: left + 10, top: top + 10 });
    cursor += (wide ? h : w) + GUTTER;
    maxCross = Math.max(maxCross, wide ? w : h);
  }

  const width = wide ? maxCross + 2 * GUTTER : cursor;
  const height = wide ? cursor : maxCross + 2 * GUTTER;
  return toDataUrl(sharp({ create: { width, height, channels: 3, background: GROUND } }).composite(layers));
}

/** Turns stored images into the frames one analysis sends, following the grouping from packFrames. */
export async function buildFrames(
  entryDir: string,
  images: { id: string; width: number; height: number }[],
  groups: number[][],
): Promise<Frame[]> {
  const frames: Frame[] = [];
  for (const group of groups) {
    const cells = group.map((index) => {
      const image = images[index];
      return { file: join(entryDir, `${image.id}.webp`), width: image.width, height: image.height };
    });
    frames.push({
      dataUrl: cells.length === 1 ? await single(cells[0].file) : await sheet(cells),
      images: cells.length,
    });
  }
  return frames;
}
