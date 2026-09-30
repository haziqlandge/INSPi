'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import Folder from '@/components/bits/Folder';
import { useToast } from '@/components/feedback/toast';
import { PlusIcon } from '@/components/ui/icons';
import { api, LIBRARY_CHANGED } from '@/lib/client/api';
import { useCssColor } from '@/lib/client/use-css-color';
import type { Collection } from '@/lib/types';
import { TagIndex } from './tag-index';

function Tile({ collection, color }: { collection: Collection; color: string }) {
  const papers = collection.covers.slice(0, 3).map((cover) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img key={cover.id} src={cover.thumb} alt="" className="h-full w-full rounded-[10px] object-cover" />
  ));
  return (
    <Link
      href={`/collections/${collection.slug}`}
      className="group block rounded-2xl border border-transparent px-4 pb-5 pt-16 text-center transition-colors hover:border-line hover:bg-surface/70"
    >
      {/* The folder is decoration; the whole tile is the link. Hovering the tile lifts its flap. */}
      <div className="pointer-events-none mx-auto flex h-[8.5rem] w-40 items-end justify-center" aria-hidden="true">
        <Folder color={color} size={1.5} items={papers} />
      </div>
      <p className="display mt-7 truncate text-[1.5rem] leading-tight">{collection.name}</p>
      <p className="mt-0.5 text-sm text-muted">
        {collection.count} {collection.count === 1 ? 'entry' : 'entries'}
      </p>
    </Link>
  );
}

export function CollectionsView() {
  const toast = useToast();
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const folderColor = useCssColor('--accent', '#7f520a');

  const load = useCallback(async () => {
    try {
      const { collections: list } = await api<{ collections: Collection[] }>('/api/collections');
      setCollections(list);
    } catch (error) {
      setCollections([]);
      toast.show(error instanceof Error ? error.message : 'Collections could not be loaded.', { tone: 'error' });
    }
  }, [toast]);

  useEffect(() => {
    void load();
    window.addEventListener(LIBRARY_CHANGED, load);
    return () => window.removeEventListener(LIBRARY_CHANGED, load);
  }, [load]);

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      await api('/api/collections', { method: 'POST', json: { name } });
      setName('');
      await load();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'The collection could not be created.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="px-4 pt-6 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-5">
        <div>
          <h1 className="display text-[clamp(2.5rem,5vw,4rem)] leading-none">Collections</h1>
          <p className="mt-3 max-w-[34rem] text-muted">
            INSPi files each new entry into the collections that match its look. Make your own as well: they join the list it chooses from. An entry can sit in several; add one by hand from its page.
          </p>
        </div>
        <form
          className="flex w-full max-w-sm gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            void create();
          }}
        >
          <input
            className="field"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Client X moodboard"
            aria-label="New collection name"
            maxLength={60}
          />
          <button type="submit" className="btn btn-primary flex-none" disabled={busy || !name.trim()}>
            <PlusIcon size={15} />
            Create
          </button>
        </form>
      </div>

      {collections?.length === 0 && (
        <p className="mt-16 text-center text-muted">No collections yet. Name one above to make the first.</p>
      )}

      {collections && collections.length > 0 && (
        <ul className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {collections.map((collection) => (
            <li key={collection.id}>
              <Tile collection={collection} color={folderColor} />
            </li>
          ))}
        </ul>
      )}

      <TagIndex />
    </div>
  );
}
