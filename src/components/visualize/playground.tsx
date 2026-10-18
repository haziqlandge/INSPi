'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/client/api';
import { AspectPicker, CyclingPlaceholder, ShutterButton } from '@/components/fx/library';
import { CloseIcon, ImagesIcon } from '@/components/ui/icons';
import type { Settings } from '@/lib/settings';
import { Switch } from '@/components/ui/segmented';
import { effectiveChoice } from '@/lib/client/imagine';
import { SUBJECT_LABELS } from '@/lib/copy/compose';
import { EntryPicker, type PickedPrompt } from './entry-picker';
import { ModelSelect, useImageCatalog } from './model-select';

export interface Draft {
  prompt: string;
  negative: string;
  aspect: string;
  from: PickedPrompt | null;
  /** With a prompt from an entry: show the model the entry's first picture too. */
  reference?: boolean;
}

export const ASPECTS = ['1:1', '3:2', '2:3', '16:9', '9:16', '4:5'];

/** Shown only until the library's own prompts arrive, or when it has no image entries yet. */
const FALLBACK_EXAMPLES = ['Write a prompt, or borrow one from an entry above.'];

/** Nearest ratio from the list, so an entry's "21:9" still lands on a chip. */
function nearestAspect(aspect: string): string {
  const [w, h] = aspect.split(':').map(Number);
  if (!(w > 0 && h > 0)) return '1:1';
  const target = w / h;
  return ASPECTS.reduce((best, a) => {
    const [aw, ah] = a.split(':').map(Number);
    const [bw, bh] = best.split(':').map(Number);
    return Math.abs(aw / ah - target) < Math.abs(bw / bh - target) ? a : best;
  });
}

export function Playground({
  draft,
  setDraft,
  choice,
  onChoice,
  busy,
  error,
  onGenerate,
}: {
  draft: Draft;
  setDraft: (next: Draft) => void;
  choice: Settings['imagine'];
  onChoice: (next: Settings['imagine']) => void;
  busy: boolean;
  error: string | null;
  onGenerate: () => void;
}) {
  const [picking, setPicking] = useState(false);
  const [focused, setFocused] = useState(false);
  // The placeholder types out your own image prompts, not invented ones.
  const [examples, setExamples] = useState(FALLBACK_EXAMPLES);
  useEffect(() => {
    api<{ examples: string[] }>('/api/imagine/examples')
      .then((r) => r.examples.length && setExamples(r.examples))
      .catch(() => {});
  }, []);
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });
  const { catalog } = useImageCatalog();
  const target = effectiveChoice(choice, catalog?.recommended ?? null);
  const model = catalog?.backends.flatMap((b) => b.models).find((m) => m.id === target.model) ?? null;
  const canSeeImage = target.backend !== 'keyless-url' && Boolean(model?.acceptsImage);

  return (
    <form
      className="space-y-6"
      onSubmit={(event) => {
        event.preventDefault();
        onGenerate();
      }}
    >
      <div>
        <div className="flex items-center justify-between gap-3">
          <label htmlFor="viz-prompt" className="text-[0.8125rem] font-medium text-head">
            Prompt
          </label>
          <button type="button" className="inline-flex items-center gap-1.5 text-[0.8125rem] text-muted hover:text-head" onClick={() => setPicking(true)}>
            <ImagesIcon size={15} />
            Use an entry&rsquo;s prompt
          </button>
        </div>
        {draft.from && (
          <p className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-accent/50 py-1 pl-3 pr-1 text-[0.8125rem] text-accent">
            From {draft.from.entryName} · {SUBJECT_LABELS[draft.from.subject]}
            <button type="button" className="icon-btn h-6 w-6" aria-label="Stop linking to this entry" onClick={() => set({ from: null, reference: false })}>
              <CloseIcon size={12} />
            </button>
          </p>
        )}
        {draft.from && (
          <div className={`mt-2 flex items-start gap-3 rounded-xl border border-line p-3 ${canSeeImage ? '' : 'opacity-70'}`}>
            <Switch checked={Boolean(draft.reference) && canSeeImage} onChange={(reference) => set({ reference })} label="Show the model the original picture" disabled={!canSeeImage} />
            <div className="min-w-0 text-[0.8125rem] leading-snug">
              <p className="font-medium text-head">Show the model the original picture</p>
              <p className="mt-0.5 text-muted">
                {canSeeImage
                  ? `Closest to a one-to-one copy. Sends ${draft.from.entryName}’s first picture to Pollinations with the prompt.`
                  : `${model?.label ?? 'This model'} cannot take a picture. GPT Image, MAI Image, FLUX Kontext and FLUX.2 Klein can.`}
              </p>
            </div>
          </div>
        )}
        <div className="relative mt-2">
          <textarea
            id="viz-prompt"
            className="field min-h-[min(9.5rem,22dvh)] resize-y leading-relaxed"
            value={draft.prompt}
            maxLength={32000}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(e) => set({ prompt: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) onGenerate();
            }}
          />
          <CyclingPlaceholder examples={examples} active={!draft.prompt && !focused} />
        </div>
        <p className="mt-1 text-right text-[0.75rem] tabular-nums text-muted">{draft.prompt.length.toLocaleString("en")} / 32,000 · Ctrl+Enter makes it</p>
      </div>

      <div>
        <label htmlFor="viz-negative" className="text-[0.8125rem] font-medium text-head">
          Avoid
        </label>
        <input
          id="viz-negative"
          className="field mt-2"
          value={draft.negative}
          maxLength={1000}
          placeholder="text, watermark, extra fingers"
          onChange={(e) => set({ negative: e.target.value })}
        />
      </div>

      <div>
        <p className="text-[0.8125rem] font-medium text-head">Shape</p>
        <div className="mt-2">
          <AspectPicker options={ASPECTS} value={nearestAspect(draft.aspect)} onChange={(aspect) => set({ aspect })} />
        </div>
      </div>

      <div>
        <p className="text-[0.8125rem] font-medium text-head">Model</p>
        <div className="mt-2">
          <ModelSelect value={choice} onChange={onChoice} />
        </div>
      </div>

      {error && (
        <p className="rounded-xl border border-danger/40 bg-danger/5 px-3.5 py-2.5 text-sm text-ink" role="alert">
          {error}
        </p>
      )}

      {/* Stays at the foot of the column while the column scrolls, so Generate is always in reach */}
      <div className="sticky bottom-0 z-[1] -mx-1 flex flex-wrap items-center gap-3 border-t border-line/70 bg-paper px-1 pb-1 pt-3">
        <ShutterButton type="submit" busy={busy} disabled={!draft.prompt.trim()}>
          {busy ? 'Developing' : 'Generate'}
        </ShutterButton>
        <span className="text-[0.8125rem] text-muted">One try with the model above. Spends Pollen unless Keyless is picked.</span>
      </div>

      <EntryPicker
        open={picking}
        onClose={() => setPicking(false)}
        onPick={(picked) => setDraft({ prompt: picked.prompt, negative: picked.negative, aspect: picked.aspect, from: picked })}
      />
    </form>
  );
}
