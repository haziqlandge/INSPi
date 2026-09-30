'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useToast } from '@/components/feedback/toast';
import { Wall } from '@/components/gallery/wall';
import { ArrowLeftIcon, PencilIcon, TrashIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { announceChange, api } from '@/lib/client/api';
import { useEntries } from '@/lib/client/use-entries';
import type { Collection } from '@/lib/types';
import { tagList, toggleTag } from '@/lib/client/tags';

export function CollectionView({ initial }: { initial: Collection }) {
  const router = useRouter();
  const toast = useToast();
  const [collection, setCollection] = useState(initial);
  const [renaming, setRenaming] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [name, setName] = useState(initial.name);
  const [busy, setBusy] = useState(false);
  const { data } = useEntries(`collection=${collection.id}&limit=200`);
  const [picked, setPicked] = useState('');

  // The tags found inside this collection, most common first; picking several keeps entries with all of them.
  const inside = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of data?.items ?? []) for (const tag of entry.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [data]);
  const chosen = tagList(picked);
  const shown = (data?.items ?? []).filter((entry) => chosen.every((tag) => entry.tags.includes(tag)));

  async function rename() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const saved = await api<Collection>(`/api/collections/${collection.id}`, { method: 'PATCH', json: { name } });
      setCollection(saved);
      setRenaming(false);
      announceChange();
      if (saved.slug !== collection.slug) router.replace(`/collections/${saved.slug}`);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'The name could not be saved.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    setBusy(true);
    try {
      await api(`/api/collections/${collection.id}`, { method: 'DELETE' });
      announceChange();
      toast.show('Collection deleted. Its entries are still in the library.');
      router.push('/collections');
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'The collection could not be deleted.', { tone: 'error' });
      setBusy(false);
    }
  }

  return (
    <div className="px-4 pt-2 sm:px-8">
      <Link href="/collections" className="inline-flex items-center gap-2 rounded-full py-2 pr-3 text-[0.9375rem] text-muted hover:text-head">
        <ArrowLeftIcon size={16} />
        Collections
      </Link>

      <div className="mt-2 flex flex-wrap items-end gap-x-4 gap-y-2">
        <h1 className="display text-[clamp(2.5rem,5vw,4rem)] leading-none">{collection.name}</h1>
        <p className="pb-1 text-muted">
          {data?.total ?? collection.count} {(data?.total ?? collection.count) === 1 ? 'entry' : 'entries'}
        </p>
        <div className="ml-auto flex">
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              setName(collection.name);
              setRenaming(true);
            }}
            aria-label="Rename collection"
          >
            <PencilIcon />
          </button>
          <button type="button" className="icon-btn hover:!text-danger" onClick={() => setConfirming(true)} aria-label="Delete collection">
            <TrashIcon />
          </button>
        </div>
      </div>

      {inside.length > 1 && (
        <div className="mt-5 flex flex-wrap gap-1.5" aria-label="Tags in this collection">
          {inside.map(([tag, count]) => (
            <button key={tag} type="button" className="chip" aria-pressed={chosen.includes(tag)} onClick={() => setPicked(toggleTag(picked, tag))}>
              {tag} <span className="tabular-nums opacity-70">{count}</span>
            </button>
          ))}
        </div>
      )}

      <div className="mt-7">
        {data && shown.length > 0 && <Wall entries={shown} />}
        {data && data.items.length > 0 && shown.length === 0 && (
          <p className="py-16 text-center text-muted">No entry here has all of those tags.</p>
        )}
        {data && data.items.length === 0 && (
          <p className="py-16 text-center text-muted">
            Nothing in here yet. Open an entry and use the folder button to add it.
          </p>
        )}
      </div>

      <Modal open={renaming} onClose={() => setRenaming(false)} title="Rename collection" locked={busy}>
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void rename();
          }}
        >
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-label="Collection name" data-autofocus />
          <div className="mt-5 flex justify-end gap-2">
            <button type="button" className="btn" onClick={() => setRenaming(false)} disabled={busy}>
              Cancel
            </button>
            <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
              Save name
            </button>
          </div>
        </form>
      </Modal>

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Delete this collection?" locked={busy}>
        <p className="text-ink">
          “{collection.name}” will be removed. The {collection.count === 1 ? 'entry' : 'entries'} inside it stay in the library.
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => setConfirming(false)} disabled={busy} data-autofocus>
            Keep it
          </button>
          <button type="button" className="btn btn-danger" onClick={remove} disabled={busy}>
            Delete collection
          </button>
        </div>
      </Modal>
    </div>
  );
}
