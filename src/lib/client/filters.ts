'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useMemo } from 'react';
import type { Mode } from '@/lib/types';

export interface Filters {
  q: string;
  category: string;
  tag: string;
  mode: Mode | '';
  fav: boolean;
}

/** Library filters live in the URL, so they survive a reload and the back button undoes them. */
export function useFilters(): { filters: Filters; setFilters: (patch: Partial<Filters>) => void; query: string } {
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters = useMemo<Filters>(() => {
    const mode = params.get('mode');
    return {
      q: params.get('q') ?? '',
      category: params.get('category') ?? '',
      tag: params.get('tag') ?? '',
      mode: mode === 'web' || mode === 'image' ? mode : '',
      fav: params.get('fav') === '1',
    };
  }, [params]);

  const query = useMemo(() => toQuery(filters), [filters]);

  const setFilters = useCallback(
    (patch: Partial<Filters>) => {
      // From any other page, a filter change is a trip back to the library.
      const base: Filters = pathname === '/' ? filters : { q: '', category: '', tag: '', mode: '', fav: false };
      const next = toQuery({ ...base, ...patch });
      const url = next ? `/?${next}` : '/';
      if (pathname === '/') router.replace(url, { scroll: false });
      else router.push(url);
    },
    [filters, pathname, router],
  );

  return { filters, setFilters, query };
}

export function toQuery(filters: Partial<Filters>): string {
  const out = new URLSearchParams();
  if (filters.q?.trim()) out.set('q', filters.q.trim());
  if (filters.category) out.set('category', filters.category);
  if (filters.tag) out.set('tag', filters.tag);
  if (filters.mode) out.set('mode', filters.mode);
  if (filters.fav) out.set('fav', '1');
  return out.toString();
}
