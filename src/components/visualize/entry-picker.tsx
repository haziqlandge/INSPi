'use client';

import { useEffect, useState } from 'react';
import { SearchIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { Segmented } from '@/components/ui/segmented';
import type { ImageSpec } from '@/lib/ai/schema/display';
import { composePrompt, SUBJECT_LABELS, SUBJECT_MODES, type SubjectMode } from '@/lib/copy/compose';
import { api } from '@/lib/client/api';
import type { EntryCard, EntryDetail } from '@/lib/types';

export interface PickedPrompt {
  entryId: string;
  entryName: string;
  versionId: string;
  prompt: string;
  negative: string;
  aspect: string;
  /** What the prompt does with the entry's subject. */
  subject: SubjectMode;
}

const MODE_KEY = 'inspi:visualize-subject';

/** The subject mode last used here or in an entry's Visualize window (they share it). */
function savedMode(): SubjectMode {
  try {
    const raw = JSON.parse(localStorage.getItem(MODE_KEY) ?? 'null') as { mode?: unknown } | null;
    return SUBJECT_MODES.find((m) => m === raw?.mode) ?? 'recreate';
  } catch {
    return 'recreate';
  }
}

function saveMode(mode: SubjectMode): void {
  try {
    const raw = JSON.parse(localStorage.getItem(MODE_KEY) ?? '{}') as Record<string, unknown>;
    localStorage.setItem(MODE_KEY, JSON.stringify({ ...raw, mode }));
  } catch {
    // only a convenience
  }
}

/**
 * Search the image entries and take one's active prompt into the playground, with the subject
 * recreated (the picture again), replaced by yours, or left to the model (style only).
 */
export function EntryPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (picked: PickedPrompt) => void }) {
  const [q, setQ] = useState('');
  const [items, setItems] = useState<EntryCard[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<SubjectMode>('recreate');
  const [mine, setMine] = useState('');
  const [working, setWorking] = useState<string | null>(null);

  useEffect(() => {
    if (open) setMode(savedMode());
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      const query = new URLSearchParams({ mode: 'image', limit: '24' });
      if (q.trim()) query.set('q', q.trim());
      api<{ items: EntryCard[] }>(`/api/entries?${query}`)
        .then((r) => setItems(r.items.filter((e) => e.hasPrompt)))
        .catch((e: unknown) => setError(e instanceof Error ? e.message : 'Could not search.'));
    }, 180);
    return () => window.clearTimeout(timer);
  }, [open, q]);

  async function pick(card: EntryCard) {
    if (working) return;
    if (mode === 'mine' && !mine.trim()) {
      setError('Write your subject first.');
      return;
    }
    setError(null);
    setWorking(card.id);
    try {
      const entry = await api<EntryDetail>(`/api/entries/${card.id}`);
      const version = entry.versions.find((v) => v.id === entry.activeVersionId);
      if (!version || version.spec.inspi !== 'image/1') throw new Error('That entry has no image prompt yet.');
      const spec = version.spec as ImageSpec;
      let subject = spec.subject ?? '';
      // Entries made before the analysis kept the subject: describe it once (one small vision call)
      if (mode === 'recreate' && !subject) {
        subject = (await api<{ subject: string }>(`/api/entries/${entry.id}/subject`, { method: 'POST', json: { versionId: version.id } })).subject;
      }
      saveMode(mode);
      onPick({
        entryId: entry.id,
        entryName: entry.name,
        versionId: version.id,
        // Instruction (with the subject choice) plus the JSON, which carries the avoid list.
        prompt: composePrompt(spec, mode === 'recreate' ? { mode, text: subject } : mode === 'mine' ? { mode, text: mine } : { mode }),
        negative: '',
        aspect: spec.params.aspect_ratio,
        subject: mode,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That did not work.');
    } finally {
      setWorking(null);
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Use an entry's prompt" wide>
      <div className="mb-4 rounded-xl border border-line p-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[0.8125rem] font-medium text-head">Subject</p>
            <p className="text-[0.75rem] text-muted">
              {mode === 'recreate'
                ? 'The same subject and arrangement as the picture.'
                : mode === 'mine'
                  ? 'Your subject, in the entry’s style.'
                  : 'Style only; the model invents a subject.'}
            </p>
          </div>
          <Segmented<SubjectMode>
            label="Subject"
            size="sm"
            value={mode}
            onChange={setMode}
            options={SUBJECT_MODES.map((m) => ({ value: m, label: SUBJECT_LABELS[m] }))}
          />
        </div>
        {mode === 'mine' && (
          <input
            className="field mt-3 !text-[0.875rem]"
            value={mine}
            onChange={(e) => setMine(e.target.value)}
            placeholder="A lighthouse on a cliff at dusk"
            aria-label="Your subject"
            maxLength={600}
          />
        )}
      </div>
      <label className="relative block">
        <span className="sr-only">Search image entries</span>
        <SearchIcon size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
        <input className="field pl-9" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search names, tags, categories" autoFocus />
      </label>
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
      <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
        {items.map((card) => (
          <li key={card.id}>
            <button type="button" onClick={() => void pick(card)} disabled={Boolean(working)} className="group block w-full text-left disabled:cursor-wait">
              <span className="relative block aspect-[4/3] overflow-hidden rounded-xl bg-surface shadow-print" style={{ background: card.cover?.placeholder }}>
                {card.cover && (
                  // eslint-disable-next-line @next/next/no-img-element -- stored WebP served by our own route
                  <img src={card.cover.thumb} alt="" className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.04]" />
                )}
                {working === card.id && (
                  <span className="absolute inset-0 grid place-items-center bg-paper/70 text-[0.8125rem] text-head" role="status">
                    {mode === 'recreate' ? 'Describing…' : 'Loading…'}
                  </span>
                )}
              </span>
              <span className="mt-1.5 block truncate text-[0.875rem] font-medium text-head">{card.name}</span>
              <span className="block truncate text-[0.75rem] text-muted">{card.category}</span>
            </button>
          </li>
        ))}
      </ul>
      {items.length === 0 && !error && <p className="mt-4 text-sm text-muted">No image entries with a prompt match that.</p>}
    </Modal>
  );
}
