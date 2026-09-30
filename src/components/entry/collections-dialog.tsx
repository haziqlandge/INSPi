'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/feedback/toast';
import { CheckIcon, PlusIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { announceChange, api } from '@/lib/client/api';
import type { Collection } from '@/lib/types';

interface Props {
  entryId: string;
  memberOf: string[];
  open: boolean;
  onClose: () => void;
  onChange: (collectionIds: string[]) => void;
}

/** Tick the collections this entry belongs to, or start a new one. */
export function CollectionsDialog({ entryId, memberOf, open, onClose, onChange }: Props) {
  const toast = useToast();
  const [collections, setCollections] = useState<Collection[] | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    api<{ collections: Collection[] }>('/api/collections')
      .then((r) => setCollections(r.collections))
      .catch(() => setCollections([]));
  }, [open]);

  async function toggle(collection: Collection) {
    const inside = memberOf.includes(collection.id);
    // Show the tick at once; put it back if the server disagrees.
    onChange(inside ? memberOf.filter((id) => id !== collection.id) : [...memberOf, collection.id]);
    try {
      await api(`/api/collections/${collection.id}/entries`, { method: inside ? 'DELETE' : 'POST', json: { entryId } });
      announceChange();
    } catch (error) {
      onChange(memberOf);
      toast.show(error instanceof Error ? error.message : 'That could not be saved.', { tone: 'error' });
    }
  }

  async function create() {
    if (!name.trim() || busy) return;
    setBusy(true);
    try {
      const created = await api<Collection>('/api/collections', { method: 'POST', json: { name } });
      await api(`/api/collections/${created.id}/entries`, { method: 'POST', json: { entryId } });
      setCollections((list) => [created, ...(list ?? [])]);
      onChange([...memberOf, created.id]);
      setName('');
      announceChange();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'The collection could not be created.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Collections">
      <form
        className="flex gap-2"
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
          data-autofocus
        />
        <button type="submit" className="btn flex-none" disabled={busy || !name.trim()}>
          <PlusIcon size={15} />
          Create
        </button>
      </form>

      <ul className="mt-4 space-y-1">
        {collections === null && <li className="py-3 text-sm text-muted">Loading…</li>}
        {collections?.length === 0 && <li className="py-3 text-sm text-muted">No collections yet. Name one above to start it with this entry.</li>}
        {collections?.map((collection) => {
          const inside = memberOf.includes(collection.id);
          return (
            <li key={collection.id}>
              <button
                type="button"
                role="checkbox"
                aria-checked={inside}
                onClick={() => toggle(collection)}
                className="flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors hover:bg-head/5"
              >
                <span
                  className={`grid h-5 w-5 flex-none place-items-center rounded-md border ${
                    inside ? 'border-head bg-head text-paper' : 'border-muted/60'
                  }`}
                >
                  {inside && <CheckIcon size={13} />}
                </span>
                <span className="min-w-0 flex-1 truncate text-ink">{collection.name}</span>
                <span className="text-sm tabular-nums text-muted">{collection.count}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </Modal>
  );
}
