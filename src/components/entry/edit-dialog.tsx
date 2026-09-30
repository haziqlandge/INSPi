'use client';

import { useEffect, useState, type KeyboardEvent } from 'react';
import { useToast } from '@/components/feedback/toast';
import { CloseIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { updateEntry } from '@/lib/client/actions';
import { CATEGORIES } from '@/lib/library/categories';
import { normalizeTag } from '@/lib/library/tags';
import type { EntryDetail } from '@/lib/types';

interface Props {
  entry: EntryDetail;
  open: boolean;
  onClose: () => void;
  onSaved: (entry: EntryDetail) => void;
}

const MAX_TAGS = 20;

export function EditDialog({ entry, open, onClose, onSaved }: Props) {
  const toast = useToast();
  const [name, setName] = useState(entry.name);
  const [category, setCategory] = useState<string>(entry.category);
  const [tags, setTags] = useState(entry.tags);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);

  // Start from the saved values each time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setName(entry.name);
    setCategory(entry.category);
    setTags(entry.tags);
    setDraft('');
  }, [open, entry]);

  function addDraft(): string[] {
    const pieces = draft.split(',').map(normalizeTag).filter((t): t is string => Boolean(t));
    const next = [...tags];
    for (const tag of pieces) if (!next.includes(tag) && next.length < MAX_TAGS) next.push(tag);
    setTags(next);
    setDraft('');
    return next;
  }

  function onTagKey(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Enter' || event.key === ',') {
      event.preventDefault();
      addDraft();
    } else if (event.key === 'Backspace' && draft === '' && tags.length) {
      setTags(tags.slice(0, -1));
    }
  }

  async function save() {
    if (!name.trim()) {
      toast.show('Give the entry a name.', { tone: 'error' });
      return;
    }
    setSaving(true);
    try {
      const saved = await updateEntry(entry.id, { name, category, tags: draft.trim() ? addDraft() : tags });
      onSaved(saved);
      onClose();
      toast.show('Changes saved');
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Those changes could not be saved.', { tone: 'error' });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Edit entry" locked={saving}>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void save();
        }}
      >
        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-head">Name</span>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} data-autofocus />
        </label>

        <label className="block">
          <span className="mb-1.5 block text-sm font-medium text-head">Category</span>
          <select className="field" value={category} onChange={(e) => setCategory(e.target.value)}>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>

        <div>
          <label htmlFor="edit-tags" className="mb-1.5 block text-sm font-medium text-head">
            Tags
          </label>
          <div className="field flex flex-wrap items-center gap-1.5 !py-2">
            {tags.map((tag) => (
              <span key={tag} className="chip !py-0.5 !pr-1">
                {tag}
                <button
                  type="button"
                  className="grid h-5 w-5 place-items-center rounded-full hover:bg-head/10 hover:text-head"
                  onClick={() => setTags(tags.filter((t) => t !== tag))}
                  aria-label={`Remove ${tag}`}
                >
                  <CloseIcon size={11} />
                </button>
              </span>
            ))}
            <input
              id="edit-tags"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={onTagKey}
              onBlur={() => draft.trim() && addDraft()}
              placeholder={tags.length ? 'Add another' : 'neon lights, mountains'}
              className="min-w-[8rem] flex-1 bg-transparent py-1 text-[0.9375rem] outline-none placeholder:text-muted/70"
            />
          </div>
          <p className="mt-1.5 text-[0.8125rem] text-muted">Press Enter or a comma after each tag.</p>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn" onClick={onClose} disabled={saving}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
