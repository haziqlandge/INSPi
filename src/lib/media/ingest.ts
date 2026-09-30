import { createHash } from 'node:crypto';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import type { NewImage } from '../store/library';

// Without this, sharp keeps image files open on Windows and they cannot be deleted afterwards.
sharp.cache({ files: 0 });

export const MAX_UPLOAD_BYTES = 20 * 1024 * 1024;
const ACCEPTED_FORMATS = new Set(['jpeg', 'png', 'webp', 'gif', 'avif', 'tiff', 'heif']);
const FULL_EDGE = 2000;
const THUMB_WIDTH = 720;
/** Guards against decompression bombs: about 100 megapixels. */
const MAX_PIXELS = 100_000_000;

export class UploadError extends Error {}

const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');

/**
 * Validates an upload by decoding it (not by trusting its name or MIME type), then stores a
 * web-sized WebP and a thumbnail in the entry's folder.
 */
export async function ingestImage(buffer: Buffer, entryDir: string): Promise<NewImage> {
  if (buffer.length === 0) throw new UploadError('That file is empty.');
  if (buffer.length > MAX_UPLOAD_BYTES) throw new UploadError('Images can be at most 20 MB each.');

  let format: string | undefined;
  try {
    ({ format } = await sharp(buffer, { limitInputPixels: MAX_PIXELS }).metadata());
  } catch {
    throw new UploadError('That file could not be read as an image.');
  }
  if (!format || !ACCEPTED_FORMATS.has(format)) {
    throw new UploadError('Use a PNG, JPEG, WebP, GIF or AVIF image.');
  }

  await mkdir(entryDir, { recursive: true });
  const id = nanoid(10);

  // First frame only for animated files; rotate() applies the camera's orientation tag.
  const upright = sharp(buffer, { limitInputPixels: MAX_PIXELS, animated: false }).rotate();

  const full = await upright
    .clone()
    .resize({ width: FULL_EDGE, height: FULL_EDGE, fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 86 })
    .toFile(join(entryDir, `${id}.webp`));

  await upright
    .clone()
    .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
    .webp({ quality: 76 })
    .toFile(join(entryDir, `${id}.thumb.webp`));

  // Mean colour of the image, shown as the card's background until the thumbnail loads.
  const { channels } = await upright.clone().resize(64, 64, { fit: 'inside' }).flatten({ background: '#ffffff' }).stats();
  const [r, g, b] = channels.map((c) => c.mean);

  return {
    id,
    width: full.width,
    height: full.height,
    bytes: full.size,
    placeholder: `#${toHex(r)}${toHex(g ?? r)}${toHex(b ?? r)}`,
    sha256: createHash('sha256').update(buffer).digest('hex'),
  };
}
