export const MAX_IMAGES_PLAIN = 3;
export const MAX_IMAGES_COMPRESSED = 9;
const PER_FRAME = 3;

/**
 * Decides which images travel together. Each inner array is one frame sent to the model:
 * a single image in plain mode, or a collage of up to three in compressed mode.
 */
export function packFrames(count: number, compress: boolean): number[][] {
  if (!Number.isInteger(count) || count < 1) throw new Error('At least one image is needed.');

  if (!compress) {
    if (count > MAX_IMAGES_PLAIN) {
      throw new Error(`More than ${MAX_IMAGES_PLAIN} images need Compress turned on.`);
    }
    return Array.from({ length: count }, (_, i) => [i]);
  }

  if (count > MAX_IMAGES_COMPRESSED) {
    throw new Error(`An entry can hold at most ${MAX_IMAGES_COMPRESSED} images.`);
  }

  const slots = Math.ceil(count / PER_FRAME);
  const base = Math.floor(count / slots);
  const extra = count % slots;
  const groups: number[][] = [];
  let next = 0;
  for (let slot = 0; slot < slots; slot++) {
    const size = base + (slot < extra ? 1 : 0);
    groups.push(Array.from({ length: size }, () => next++));
  }
  return groups;
}
