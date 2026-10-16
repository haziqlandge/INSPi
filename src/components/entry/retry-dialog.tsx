'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { CheckIcon, RetryIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { lensForVersion } from '@/lib/ai/prompts/lenses';
import { focusAreas, STEER_NOTE_MAX } from '@/lib/ai/prompts/steer';
import type { Mode, RunChoice, Steer } from '@/lib/types';
import { RunWith } from './run-with';

interface Props {
  open: boolean;
  onClose: () => void;
  mode: Mode;
  /** The number the new version will get. */
  nextVersion: number;
  busy: boolean;
  /** The entry has no version yet (its first analysis failed): no guidance, only the provider choice. */
  firstTry?: boolean;
  onRetry: (steer: Steer | undefined, run: RunChoice | undefined) => void;
}

/** What each lens in the retry rotation looks at hardest, in words. */
const EMPHASIS: Record<string, (mode: Mode) => string> = {
  balanced: () => 'everything evenly',
  structure: () => 'layout and structure',
  surface: () => 'colour, light and surfaces',
  detail: () => 'type and small details',
  behaviour: (mode) => (mode === 'web' ? 'interaction and motion cues' : 'medium and camera'),
};

/** Retry, optionally pointed at the areas the last version got wrong and told what to check. */
export function RetryDialog({ open, onClose, mode, nextVersion, busy, firstTry, onRetry }: Props) {
  const [focus, setFocus] = useState<string[]>([]);
  const [note, setNote] = useState('');
  const [run, setRun] = useState<RunChoice | null>(null);
  const [runReady, setRunReady] = useState(true);

  // Every retry starts from a clean slate.
  useEffect(() => {
    if (open) {
      setFocus([]);
      setNote('');
    }
  }, [open]);

  const areas = focusAreas(mode);
  const guided = focus.length > 0 || note.trim().length > 0;
  const rotation = EMPHASIS[lensForVersion(nextVersion).id]?.(mode) ?? 'everything evenly';

  function toggle(id: string) {
    setFocus((current) => (current.includes(id) ? current.filter((f) => f !== id) : [...current, id]));
  }

  function submit() {
    if (!runReady) return;
    onRetry(guided && !firstTry ? { focus, note: note.trim() } : undefined, run ?? undefined);
  }

  return (
    <Modal open={open} onClose={onClose} title={firstTry ? 'Try again' : 'Retry'} locked={busy}>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submit();
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            submit();
          }
        }}
      >
        <p className="text-[0.9375rem] leading-relaxed text-muted">
          {firstTry
            ? 'The analysis runs again from the start. Pick another provider or model below if the last one failed.'
            : `Version ${nextVersion} gets its own note and prompt. The name, category and tags stay as they are.`}
        </p>

        {!firstTry && (
        <>
        <fieldset className="mt-5">
          <legend className="text-sm font-medium text-head">Look closer at</legend>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {areas.map((area) => {
              const on = focus.includes(area.id);
              return (
                <motion.button
                  key={area.id}
                  type="button"
                  className="chip py-1.5"
                  aria-pressed={on}
                  onClick={() => toggle(area.id)}
                  whileTap={{ scale: 0.94 }}
                  layout
                  transition={{ type: 'spring', stiffness: 520, damping: 30 }}
                >
                  <AnimatePresence initial={false}>
                    {on && (
                      <motion.span
                        className="-ml-0.5 grid place-items-center"
                        initial={{ width: 0, opacity: 0 }}
                        animate={{ width: 13, opacity: 1 }}
                        exit={{ width: 0, opacity: 0 }}
                        transition={{ duration: 0.18 }}
                      >
                        <CheckIcon size={13} strokeWidth={2.2} />
                      </motion.span>
                    )}
                  </AnimatePresence>
                  {area.label}
                </motion.button>
              );
            })}
          </div>
        </fieldset>

        <label className="mt-5 block">
          <span className="flex items-baseline justify-between text-sm font-medium text-head">
            What did the last version miss?
            <span className="text-xs font-normal tabular-nums text-muted">
              {note.length}/{STEER_NOTE_MAX}
            </span>
          </span>
          <textarea
            className="field mt-2 min-h-[5.5rem] resize-y leading-relaxed"
            rows={3}
            maxLength={STEER_NOTE_MAX}
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder={
              mode === 'web'
                ? 'The headline is a heavier, condensed sans. The cards have no border, only a shadow.'
                : 'The light comes from the left and is warmer. The grain is coarser.'
            }
          />
        </label>

        <p className="mt-3 min-h-[2.75rem] text-[0.8125rem] leading-relaxed text-muted" aria-live="polite">
          {focus.length
            ? 'This pass measures the areas you picked more closely than the rest.'
            : note.trim()
              ? `This pass checks your note against the image, with its emphasis on ${rotation}.`
              : `With nothing picked, retries take turns: this one puts its emphasis on ${rotation}.`}
        </p>
        </>
        )}

        <RunWith
          open={open}
          onChange={(next, ready) => {
            setRun(next);
            setRunReady(ready);
          }}
        />

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy || !runReady}>
            <RetryIcon size={16} />
            {firstTry ? 'Try again' : guided ? 'Retry with guidance' : 'Retry'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
