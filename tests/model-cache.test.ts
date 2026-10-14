import { describe, expect, it } from 'vitest';
import { readCache, writeCache, CACHE_TTL_MS } from '@/lib/client/model-cache';

function memoryStorage(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
    clear: () => data.clear(),
    key: (i) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}

describe('model list cache', () => {
  it('gives back what was stored while it is fresh', () => {
    const storage = memoryStorage();
    writeCache('models:groq', { ok: true, models: [{ id: 'a' }] }, storage, 1_000);
    expect(readCache('models:groq', storage, 1_000 + CACHE_TTL_MS - 1)).toEqual({ value: { ok: true, models: [{ id: 'a' }] }, fresh: true });
  });

  it('still gives back a stale list, marked stale, so the page can draw it and refresh quietly', () => {
    const storage = memoryStorage();
    writeCache('models:groq', [1, 2], storage, 0);
    expect(readCache('models:groq', storage, CACHE_TTL_MS + 1)).toEqual({ value: [1, 2], fresh: false });
  });

  it('is empty for a missing or broken entry, and when storage throws', () => {
    const storage = memoryStorage();
    expect(readCache('nothing', storage, 0)).toBeNull();
    storage.setItem('inspi:cache:broken', '{not json');
    expect(readCache('broken', storage, 0)).toBeNull();
    const throwing = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } } as unknown as Storage;
    expect(readCache('x', throwing, 0)).toBeNull();
    expect(() => writeCache('x', 1, throwing, 0)).not.toThrow();
  });
});
