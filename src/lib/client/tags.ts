'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, LIBRARY_CHANGED } from './api';

export interface TagInfo {
  name: string;
  count: number;
  group: string;
}

let cached: TagInfo[] | undefined;

/** Every tag in use with its count, kept current when the library changes. */
export function useTags(): TagInfo[] {
  const [tags, setTags] = useState<TagInfo[]>(() => cached ?? []);

  const load = useCallback(async () => {
    try {
      const { tags: list } = await api<{ tags: TagInfo[] }>('/api/tags');
      cached = list;
      setTags(list);
    } catch {
      // the tag finders simply stay empty
    }
  }, []);

  useEffect(() => {
    void load();
    window.addEventListener(LIBRARY_CHANGED, load);
    return () => window.removeEventListener(LIBRARY_CHANGED, load);
  }, [load]);

  return tags;
}

/** The selected tags in a filter value ("a,b"). */
export function tagList(value: string): string[] {
  return value.split(',').map((t) => t.trim()).filter(Boolean);
}

/** The filter value with `tag` switched on or off. */
export function toggleTag(value: string, tag: string): string {
  const list = tagList(value);
  return (list.includes(tag) ? list.filter((t) => t !== tag) : [...list, tag]).join(',');
}
