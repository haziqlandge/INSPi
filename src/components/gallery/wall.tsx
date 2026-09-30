'use client';

import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { EntryCard as Entry } from '@/lib/types';
import { coverRatio, EntryCard } from './entry-card';

const GAP = 20;
const MIN_COLUMN = 270;
/** Room the caption takes under each image, for balancing column heights. */
const CAPTION = 104;

interface Props {
  entries: Entry[];
}

/**
 * A masonry wall. Each entry goes to whichever column is currently shortest, using the image
 * proportions we already know, so the layout is settled before any image has loaded.
 */
export function Wall({ entries }: Props) {
  const container = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useLayoutEffect(() => {
    const el = container.current;
    if (!el) return;
    setWidth(el.clientWidth);
    const observer = new ResizeObserver(([entry]) => setWidth(Math.round(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const columns = useMemo(() => {
    if (!width) return [];
    const count = Math.max(2, Math.min(6, Math.floor((width + GAP) / (MIN_COLUMN + GAP))));
    const columnWidth = (width - GAP * (count - 1)) / count;
    const heights = new Array<number>(count).fill(0);
    const out: { entry: Entry; index: number }[][] = Array.from({ length: count }, () => []);
    entries.forEach((entry, index) => {
      const shortest = heights.indexOf(Math.min(...heights));
      out[shortest].push({ entry, index });
      heights[shortest] += columnWidth * coverRatio(entry) + CAPTION + GAP;
    });
    return out;
  }, [entries, width]);

  return (
    <div ref={container} className="flex items-start" style={{ gap: GAP }}>
      {columns.map((column, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col" style={{ gap: GAP }}>
          {column.map(({ entry, index }) => (
            <EntryCard key={entry.id} entry={entry} index={index} />
          ))}
        </div>
      ))}
    </div>
  );
}
