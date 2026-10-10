import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { entryMediaDir } from '../paths';
import type { Library } from '../store/library';
import type { PaletteSwatch } from '../types';
import { extractPalette } from './palette';

/** The measured palette of an entry's stored images; empty if none of the files can be read. */
export async function paletteForEntry(entryId: string, imageIds: string[]): Promise<PaletteSwatch[]> {
  const files = imageIds.map((id) => join(entryMediaDir(entryId), `${id}.webp`)).filter((file) => existsSync(file));
  if (!files.length) return [];
  return extractPalette(files).catch(() => []);
}

/**
 * Measures up to `limit` entries that have no palette yet. An entry whose files are gone gets an
 * empty palette so it is not tried again on every pass. Returns how many were handled.
 */
export async function backfillPalettes(lib: Library, limit: number): Promise<number> {
  const pending = lib.entriesWithoutPalette(limit);
  for (const entry of pending) {
    lib.setPalette(entry.id, await paletteForEntry(entry.id, entry.images.map((image) => image.id)));
  }
  return pending.length;
}
