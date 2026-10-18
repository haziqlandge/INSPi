'use client';

import { useEffect, useState } from 'react';
import { useToast } from '@/components/feedback/toast';
import { Segmented } from '@/components/ui/segmented';
import type { ImageSpec, SubjectMode } from '@/lib/ai/schema/display';
import { api } from '@/lib/client/api';
import { entrySubject, SUBJECT_LABELS, SUBJECT_MODES } from '@/lib/copy/compose';
import type { EntryDetail } from '@/lib/types';

const HINT: Record<SubjectMode, string> = {
  recreate: 'The same subject and arrangement as the picture.',
  mine: 'Your subject, in this style.',
  model: 'Style only; the model invents a subject.',
};

/**
 * Which prompt this image entry gives (Copy prompt, and Visualize's starting choice): the picture
 * recreated, your own subject, or style only. Saved on the version; nothing is analysed again.
 */
export function PromptSubject({
  entryId,
  versionId,
  spec,
  onSaved,
}: {
  entryId: string;
  versionId: string;
  spec: ImageSpec;
  onSaved: (entry: EntryDetail) => void;
}) {
  const toast = useToast();
  const current = entrySubject(spec);
  const [mine, setMine] = useState(spec.mySubject ?? '');
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    setMine(spec.mySubject ?? '');
    setEditing(false);
  }, [versionId, spec.mySubject]);

  async function save(mode: SubjectMode, text?: string) {
    setBusy('Saving…');
    try {
      let { entry } = await api<{ entry: EntryDetail }>(`/api/entries/${entryId}/subject`, { method: 'PUT', json: { versionId, mode, text } });
      // Entries made before the analysis kept the subject: describe it once so Recreate has one
      if (mode === 'recreate' && !spec.subject) {
        setBusy('Describing the picture…');
        await api(`/api/entries/${entryId}/subject`, { method: 'POST', json: { versionId } });
        entry = await api<EntryDetail>(`/api/entries/${entryId}`);
      }
      onSaved(entry);
      setEditing(false);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'That was not saved.', { tone: 'error' });
    } finally {
      setBusy(null);
    }
  }

  const shown: SubjectMode = editing ? 'mine' : current.mode;

  return (
    <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-2">
      <span className="text-[0.8125rem] text-muted">Copy prompt gives</span>
      <Segmented<SubjectMode>
        label="What Copy prompt gives"
        size="sm"
        value={shown}
        onChange={(mode) => {
          if (mode === 'mine' && !spec.mySubject) setEditing(true);
          else void save(mode, mode === 'mine' ? spec.mySubject : undefined);
        }}
        options={SUBJECT_MODES.map((m) => ({ value: m, label: SUBJECT_LABELS[m] }))}
      />
      {shown === 'mine' ? (
        <form
          className="flex min-w-[16rem] flex-1 items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (mine.trim()) void save('mine', mine);
          }}
        >
          <input
            className="field !py-1.5 !text-[0.8125rem]"
            value={mine}
            onChange={(e) => {
              setMine(e.target.value);
              setEditing(true);
            }}
            placeholder="Your subject, e.g. a lighthouse at dusk"
            aria-label="Your subject"
            maxLength={600}
            autoFocus={editing && !spec.mySubject}
          />
          {(editing || mine !== (spec.mySubject ?? '')) && (
            <button type="submit" className="btn !py-1.5 text-[0.8125rem]" disabled={!mine.trim() || Boolean(busy)}>
              Save
            </button>
          )}
        </form>
      ) : (
        <span className="min-w-0 truncate text-[0.75rem] text-muted" title={shown === 'recreate' ? spec.subject : undefined}>
          {busy ?? (shown === 'recreate' && spec.subject ? spec.subject : HINT[shown])}
        </span>
      )}
    </div>
  );
}
