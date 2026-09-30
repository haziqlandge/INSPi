'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { EntryCard } from '@/lib/types';
import { api, LIBRARY_CHANGED } from './api';

export interface EntryList {
  items: EntryCard[];
  total: number;
  categories: { name: string; count: number }[];
}

const POLL_MS = 2000;
const cache = new Map<string, EntryList>();

const pending = (list: EntryList | undefined) =>
  list?.items.some((item) => item.status === 'queued' || item.status === 'analyzing') ?? false;

/**
 * Loads a list of entries and keeps it current: it refetches when anything in the library changes
 * and every two seconds while an entry is still being analysed. The last result per query is
 * kept, so coming back to a page shows it immediately.
 */
export function useEntries(query: string): { data: EntryList | undefined; error: string | null; refresh: () => void } {
  const [data, setData] = useState<EntryList | undefined>(() => cache.get(query));
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(query);

  const load = useCallback(async () => {
    const asked = query;
    try {
      const list = await api<EntryList>(`/api/entries${asked ? `?${asked}` : ''}`);
      cache.set(asked, list);
      if (latest.current === asked) {
        setData(list);
        setError(null);
      }
    } catch (cause) {
      if (latest.current === asked) setError(cause instanceof Error ? cause.message : 'The library could not be loaded.');
    }
  }, [query]);

  useEffect(() => {
    latest.current = query;
    setData(cache.get(query));
    void load();
    window.addEventListener(LIBRARY_CHANGED, load);
    return () => window.removeEventListener(LIBRARY_CHANGED, load);
  }, [query, load]);

  const waiting = pending(data);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(load, POLL_MS);
    return () => window.clearInterval(timer);
  }, [waiting, load]);

  return { data, error, refresh: load };
}
