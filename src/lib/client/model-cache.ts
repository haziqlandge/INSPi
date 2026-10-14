/**
 * Model lists kept in the browser, so dropdowns draw at once instead of popping in a second later.
 * Lists are fetched once when the site opens (ModelPrefetch) and refreshed quietly when stale.
 * Browser storage can be missing or blocked; then everything simply fetches as before.
 */

export const CACHE_TTL_MS = 6 * 60 * 60_000;
const PREFIX = 'inspi:cache:';

interface Stored<T> {
  at: number;
  value: T;
}

function storageOrNull(storage?: Storage): Storage | null {
  if (storage) return storage;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readCache<T>(key: string, storage?: Storage, now = Date.now()): { value: T; fresh: boolean } | null {
  try {
    const raw = storageOrNull(storage)?.getItem(PREFIX + key);
    if (!raw) return null;
    const stored = JSON.parse(raw) as Stored<T>;
    if (typeof stored?.at !== 'number' || !('value' in stored)) return null;
    return { value: stored.value, fresh: now - stored.at < CACHE_TTL_MS };
  } catch {
    return null;
  }
}

export function writeCache<T>(key: string, value: T, storage?: Storage, now = Date.now()): void {
  try {
    storageOrNull(storage)?.setItem(PREFIX + key, JSON.stringify({ at: now, value } satisfies Stored<T>));
  } catch {
    // full or blocked storage: the list is fetched again next time
  }
}

export const modelsKey = (provider: string) => `models:${provider}`;
// v2: models removed for server errors (5 Oct 2026) must not come back from an older copy
export const IMAGE_BACKENDS_KEY = 'image-backends-v2';
