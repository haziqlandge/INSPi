'use client';

import { useCallback, useEffect, useState } from 'react';
import { copyText, useToast } from '@/components/feedback/toast';
import { SwatchColumn } from '@/components/fx/library';
import { CopyButton } from '@/components/ui/copy-button';
import { DiceIcon, TrashIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { Segmented } from '@/components/ui/segmented';
import { asCssVariables, deletePalette, roll, savePalette, type RollEngine } from '@/lib/client/palette';

import type { PaletteSwatch, SavedPalette } from '@/lib/types';
import { PaletteBar } from './palette-strip';

interface Props {
  open: boolean;
  onClose: () => void;
  entryId: string;
  measured: PaletteSwatch[];
  saved: SavedPalette[];
  onSaved: (palettes: SavedPalette[]) => void;
}

const STAGGER_MS = 60;

/**
 * The measured palette, opened up: big swatches you can lock, and Roll (or Space) to swap the
 * unlocked ones for colours that go with the locked ones. Rolls you like can be kept.
 */
export function PaletteSheet({ open, onClose, entryId, measured, saved, onSaved }: Props) {
  const toast = useToast();
  const original = measured.map((s) => s.hex);
  const [colors, setColors] = useState(original);
  const [locked, setLocked] = useState<boolean[]>(original.map(() => false));
  const [engine, setEngine] = useState<RollEngine>('harmony');
  const [rollId, setRollId] = useState(0);
  const [busy, setBusy] = useState(false);

  // Each opening starts from the measured colours.
  useEffect(() => {
    if (!open) return;
    setColors(measured.map((s) => s.hex));
    setLocked(measured.map(() => false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const allLocked = locked.every(Boolean);

  const doRoll = useCallback(async () => {
    if (busy || allLocked) return;
    setBusy(true);
    try {
      setColors(await roll(engine, colors, locked));
      setRollId((n) => n + 1);
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'The roll did not work.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }, [busy, allLocked, engine, colors, locked, toast]);

  // Space rolls, as on Coolors, wherever focus is (the dialog opens with focus on Close), except in
  // a text field. Stopping the key's default keeps the focused button from also firing; Enter still does.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== ' ' || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      event.preventDefault();
      // A button clicked a moment ago (Harmony, Colormind, a lock) would light its focus ring; drop it.
      if (target instanceof HTMLButtonElement) target.blur();
      void doRoll();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, doRoll]);

  async function copyHex(hex: string) {
    if (await copyText(hex)) toast.show(`Copied ${hex}`);
    else toast.show('Copying was blocked. Select the text and copy it by hand.', { tone: 'error' });
  }

  async function keep() {
    try {
      onSaved(await savePalette(entryId, colors));
      toast.show('Palette kept');
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'That did not work.', { tone: 'error' });
    }
  }

  async function forget(id: string) {
    try {
      onSaved(await deletePalette(entryId, id));
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'That did not work.', { tone: 'error' });
    }
  }

  const changed = colors.some((c, i) => c !== original[i]);
  // Other colours on screen flash past on the reels.
  const passing = [...colors, ...original];

  return (
    <Modal open={open} onClose={onClose} title="Palette" size="full">
      <div className="flex flex-col gap-6">
        <div>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="text-[0.8125rem] font-medium text-head">Measured from the image</p>
            {changed && (
              <button
                type="button"
                className="text-[0.8125rem] text-ink underline decoration-accent underline-offset-4"
                onClick={() => {
                  setColors(original);
                  setRollId((n) => n + 1);
                }}
              >
                Back to these
              </button>
            )}
          </div>
          <PaletteBar palette={measured} className="mt-2 h-5" onCopy={(hex) => void copyHex(hex)} />
        </div>

        <div className="fx-palette" aria-label="Working palette">
          {colors.map((color, i) => (
            <SwatchColumn
              key={i}
              color={color}
              locked={locked[i]}
              onToggleLock={() => setLocked((current) => current.map((l, j) => (j === i ? !l : l)))}
              onCopy={() => void copyHex(color)}
              rollId={rollId}
              delay={i * STAGGER_MS}
              passing={passing.filter((c) => c !== color).sort(() => 0.5 - Math.random())}
            />
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <button type="button" className="btn btn-primary" onClick={() => void doRoll()} disabled={busy || allLocked}>
            <DiceIcon size={17} className={busy ? 'motion-safe:animate-spin' : ''} />
            Roll
          </button>
          <span className="hidden text-[0.8125rem] text-muted sm:inline">
            or press <kbd className="rounded border border-line px-1.5 py-0.5 font-mono text-[0.75rem]">Space</kbd>
          </span>
          <Segmented<RollEngine>
            label="Roll with"
            size="sm"
            value={engine}
            onChange={setEngine}
            options={[
              { value: 'harmony', label: 'Harmony' },
              { value: 'colormind', label: 'Colormind' },
            ]}
          />
          <div className="ml-auto flex flex-wrap gap-2">
            <button type="button" className="btn" onClick={() => void keep()} disabled={!changed}>
              Keep this palette
            </button>
            <CopyButton variant="plain" label="Copy as hex" text={() => colors.join(', ')}>
              Hex
            </CopyButton>
            <CopyButton variant="plain" label="Copy as CSS variables" text={() => asCssVariables(colors)}>
              CSS
            </CopyButton>
          </div>
        </div>
        <p className="-mt-3 text-[0.8125rem] leading-relaxed text-muted">
          {allLocked
            ? 'Everything is locked. Unlock a colour to roll it.'
            : engine === 'harmony'
              ? 'Harmony keeps the locked colours and picks the rest from colour-wheel relationships, with a light and a dark always in the mix. Works offline.'
              : 'Colormind is a free model trained on real palettes; it answers from colormind.io.'}
        </p>

        {saved.length > 0 && (
          <section aria-labelledby="kept-heading">
            <h3 id="kept-heading" className="display text-[1.375rem] leading-tight">
              Kept palettes
            </h3>
            <ul className="mt-3 space-y-2.5">
              {saved.map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <button
                    type="button"
                    className="flex h-10 min-w-0 flex-1 overflow-hidden rounded-lg shadow-print"
                    aria-label="Load this palette into the swatches above"
                    title="Load it above"
                    onClick={() => {
                      setColors(p.colors);
                      setLocked(p.colors.map(() => false));
                      setRollId((n) => n + 1);
                    }}
                  >
                    {p.colors.map((c, i) => (
                      <span key={i} className="flex-1" style={{ background: c }} />
                    ))}
                  </button>
                  <CopyButton label="Copy as hex" text={() => p.colors.join(', ')} />
                  <button type="button" className="icon-btn hover:!text-danger" aria-label="Forget this palette" onClick={() => void forget(p.id)}>
                    <TrashIcon size={16} />
                  </button>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </Modal>
  );
}
