'use client';

import dynamic from 'next/dynamic';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import ScrollVelocity from '@/components/bits/ScrollVelocity';
import { Wall } from '@/components/gallery/wall';
import { Segmented } from '@/components/ui/segmented';
import { api, LIBRARY_CHANGED } from '@/lib/client/api';
import { useCssColor } from '@/lib/client/use-css-color';
import type { EntryCard } from '@/lib/types';

const DISCOVER_PAGE = 12;
/** Drift needs enough tiles to fill its columns without obvious repeats. */
const DRIFT_MINIMUM = 5;

// The drifting wall is heavy and desktop-only, so it loads only when someone switches to it.
const DriftWall = dynamic(() => import('@/components/bits/DriftWall'), { ssr: false });

function SectionHeading({ title, note, action }: { title: string; note: string; action?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-baseline gap-x-4 gap-y-2">
      <h2 className="display text-[clamp(2rem,4vw,3rem)] leading-none">{title}</h2>
      <p className="text-muted">{note}</p>
      {action && <div className="ml-auto self-center">{action}</div>}
    </div>
  );
}

/** True on wide screens with a mouse, where the drifting wall has room and hover to work with. */
function useRoomToDrift(): boolean {
  const [roomy, setRoomy] = useState(false);
  useEffect(() => {
    const query = window.matchMedia('(min-width: 1024px) and (hover: hover) and (pointer: fine)');
    const update = () => setRoomy(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return roomy;
}

/** A band of the entry's tags that drifts sideways and speeds up with the scroll. */
function TagBand({ tags }: { tags: string[] }) {
  if (tags.length < 2) return null;
  const line = (list: string[]) => (
    <>
      {list.map((tag) => (
        <span key={tag} className="mx-[0.6em] inline-flex items-center gap-[1.2em]">
          {tag}
          <span className="inline-block h-[0.22em] w-[0.22em] rotate-45 bg-accent" />
        </span>
      ))}
    </>
  );
  const half = Math.ceil(tags.length / 2);
  return (
    <div className="-mx-4 select-none py-14 sm:-mx-8" aria-hidden="true">
      <ScrollVelocity
        texts={[line(tags.slice(0, half)), line(tags.slice(half).length ? tags.slice(half) : tags)]}
        velocity={38}
        numCopies={8}
        className="display text-[clamp(2.25rem,6vw,4.5rem)] leading-[1.15] text-head/25"
      />
    </div>
  );
}

interface Props {
  entryId: string;
  tags: string[];
}

/** What sits under an entry: related entries first, then a random walk through the rest. */
export function MoreEntries({ entryId, tags }: Props) {
  const [related, setRelated] = useState<EntryCard[] | null>(null);
  const [discover, setDiscover] = useState<EntryCard[]>([]);
  const [more, setMore] = useState(false);
  const [seed] = useState(() => Math.floor(Math.random() * 1_000_000) + 1);
  const [view, setView] = useState<'wall' | 'drift'>('wall');
  const roomy = useRoomToDrift();
  const ground = useCssColor('--bg', '#efe4cb');
  const loading = useRef(false);
  const sentinel = useRef<HTMLDivElement>(null);

  const loadRelated = useCallback(async () => {
    try {
      const { items } = await api<{ items: EntryCard[] }>(`/api/entries/${entryId}/related`);
      setRelated(items);
      return items;
    } catch {
      setRelated([]);
      return [];
    }
  }, [entryId]);

  const loadDiscover = useCallback(
    async (offset: number, exclude: string[]) => {
      if (loading.current) return;
      loading.current = true;
      try {
        const query = new URLSearchParams({
          exclude: exclude.join(','),
          seed: String(seed),
          offset: String(offset),
          limit: String(DISCOVER_PAGE),
        });
        const page = await api<{ items: EntryCard[]; more: boolean }>(`/api/discover?${query}`);
        setDiscover((current) => (offset === 0 ? page.items : [...current, ...page.items]));
        setMore(page.more);
      } catch {
        setMore(false);
      } finally {
        loading.current = false;
      }
    },
    [seed],
  );

  const excluded = useRef<string[]>([entryId]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const items = await loadRelated();
      if (cancelled) return;
      // Discover shows everything that is neither this entry nor already listed as related.
      excluded.current = [entryId, ...items.map((i) => i.id)];
      await loadDiscover(0, excluded.current);
    };
    void load();
    window.addEventListener(LIBRARY_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(LIBRARY_CHANGED, load);
    };
  }, [entryId, loadRelated, loadDiscover]);

  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) void loadDiscover(discover.length, excluded.current);
      },
      { rootMargin: '600px' },
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [more, discover.length, loadDiscover]);

  if (related === null) return null;
  if (related.length === 0 && discover.length === 0) return null;

  return (
    <div className="mt-20">
      {related.length > 0 && (
        <section aria-label="Related entries">
          <SectionHeading title="See related" note="Same category, or tags in common." />
          <Wall entries={related} />
        </section>
      )}

      {discover.length > 0 && (
        <>
          <TagBand tags={tags} />
          <section aria-label="Discover">
            <SectionHeading
              title="Discover"
              note="A random walk through the rest of the library."
              action={
                roomy && discover.length >= DRIFT_MINIMUM ? (
                  <Segmented
                    size="sm"
                    label="Discover view"
                    value={view}
                    onChange={setView}
                    options={[
                      { value: 'wall', label: 'Wall' },
                      { value: 'drift', label: 'Drift' },
                    ]}
                  />
                ) : null
              }
            />
            {view === 'drift' && roomy && discover.length >= DRIFT_MINIMUM ? (
              <div className="-mx-4 h-[78dvh] overflow-hidden sm:-mx-8">
                <DriftWall
                  items={discover
                    .filter((entry) => entry.cover)
                    .map((entry) => ({ image: entry.cover!.thumb, title: entry.name, href: `/e/${entry.slug}` }))}
                  columns={6}
                  tileWidth={230}
                  tileHeight={290}
                  radius={4}
                  speed={30}
                  overlayColor="transparent"
                  dim={0.82}
                  pauseOnHover
                />
              </div>
            ) : (
              <Wall entries={discover} />
            )}
            <div ref={sentinel} className="h-px" />
          </section>
        </>
      )}
    </div>
  );
}
