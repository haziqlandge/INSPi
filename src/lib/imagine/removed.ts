import type { Library } from '../store/library';

/**
 * Image models removed from INSPi: every request the usage log holds for them failed with a
 * server error (5 Oct 2026), and the user verified they do not run. They are never listed, never
 * picked by AutoPick and refused if asked for by name. Do not try them again: each try spends Pollen.
 */
export const REMOVED_IMAGE_MODELS: ReadonlySet<string> = new Set([
  'microsoft/mai-image-2.6',
  'microsoft/mai-image-2.6-flash',
  'community/JustScriptzz/qwen-image-3.0-pro',
  'community/MarcosFRG/sdxl-lightning',
  'community/Spit-fires/flux-schnell',
  'community/meow18838/image-1',
  'community/scriptsnsenses-sys/sdxl-lightning-free',
  'community/sharktide/inferenceport-ai-lightning-image-plus',
  'community/sharktide/inferenceport-ai-lightning-image-turbo',
  'community/tomdacatto/grok-imagine',
  'community/tomdacatto/kling-image-3',
  'community/tomdacatto/nano-banana',
  'community/tomdacatto/nano-banana-2',
  'community/tomdacatto/nano-banana-2-lite',
  'community/tomdacatto/nano-banana-pro',
  'community/tomdacatto/sana',
  'community/tomdacatto/seedream-5-pro',
  'community/vendouple/luma-photon-1',
  'community/vendouple/nano-banana-pro',
]);

/** The verified list, plus any model whose every logged request failed with a server error since. */
export function removedImageModels(lib: Pick<Library, 'serverOnlyImageModels'>): Set<string> {
  return new Set([...REMOVED_IMAGE_MODELS, ...lib.serverOnlyImageModels()]);
}

export const REMOVED_MESSAGE = 'That model was removed: it only ever failed with server errors.';
