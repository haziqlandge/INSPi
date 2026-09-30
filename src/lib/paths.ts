import { join, resolve, sep } from 'node:path';

/** Where the database and uploaded images live. Git-ignored; override with INSPI_DATA_DIR. */
export function dataDir(): string {
  // The data folder sits outside the app's code, so the bundler must not try to trace into it.
  return resolve(/* turbopackIgnore: true */ process.env.INSPI_DATA_DIR || join(/* turbopackIgnore: true */ process.cwd(), 'data'));
}

export function mediaRoot(): string {
  return join(dataDir(), 'media');
}

export function entryMediaDir(entryId: string): string {
  if (!/^[A-Za-z0-9_-]+$/.test(entryId)) throw new Error('Invalid entry id.');
  return join(mediaRoot(), entryId);
}

/** Resolves a requested media path, or null if it would leave the media folder. */
export function safeMediaPath(segments: string[]): string | null {
  if (segments.some((s) => s === '' || s === '.' || s === '..' || /[\\/:]/.test(s))) return null;
  const root = mediaRoot();
  const full = resolve(/* turbopackIgnore: true */ root, ...segments);
  return full.startsWith(root + sep) ? full : null;
}
