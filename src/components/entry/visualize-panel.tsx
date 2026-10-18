'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/feedback/toast';
import { RenderCarousel, ShutterButton, type StripItem } from '@/components/fx/library';
import { RevealHeading } from '@/components/motion/reveal-heading';
import { TrashIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { Segmented, Switch } from '@/components/ui/segmented';
import type { ImageSpec } from '@/lib/ai/schema/display';
import { api } from '@/lib/client/api';
import { cachedImageCatalog, deleteRender, effectiveChoice, listRenders, RENDERS_CHANGED, visualize } from '@/lib/client/imagine';
import { ModelSelect, useImageCatalog } from '@/components/visualize/model-select';
import type { Settings } from '@/lib/settings';
import { sizeFor } from '@/lib/imagine/size';
import { composePrompt, SUBJECT_LABELS, SUBJECT_MODES, type SubjectChoice, type SubjectMode } from '@/lib/copy/compose';
import type { EntryVersion, Render } from '@/lib/types';

export interface VisualizeState {
  renders: Render[];
  busy: boolean;
  error: string | null;
  pending: { width: number; height: number } | null;
  choice: Settings['imagine'] | null;
  /** The version's image spec, for the dialog to compose the prompt it will send. */
  spec: ImageSpec | null;
  entryId: string;
  versionId: string | null;
  /** Makes an image with this choice (or the saved one); `remember` saves it as the default. */
  run: (choice?: Settings['imagine'], remember?: boolean, options?: RunOptions) => void;
  remove: (render: Render) => Promise<void>;
}

/** What to do with the reference's subject, and whether to show the model the picture itself. */
export interface RunOptions {
  subject: SubjectChoice;
  reference: boolean;
}

const OPTIONS_KEY = 'inspi:visualize-subject';
const DEFAULT_OPTIONS: RunOptions = { subject: { mode: 'recreate' }, reference: false };

/** The subject mode and reference switch last used (not the text, which belongs to one entry). */
function savedOptions(): RunOptions {
  try {
    const raw = JSON.parse(localStorage.getItem(OPTIONS_KEY) ?? 'null') as { mode?: unknown; reference?: unknown } | null;
    const mode = SUBJECT_MODES.find((m) => m === raw?.mode) ?? DEFAULT_OPTIONS.subject.mode;
    return { subject: { mode }, reference: raw?.reference === true };
  } catch {
    return DEFAULT_OPTIONS;
  }
}

function saveOptions(options: RunOptions): void {
  try {
    localStorage.setItem(OPTIONS_KEY, JSON.stringify({ mode: options.subject.mode, reference: options.reference }));
  } catch {
    // only a convenience
  }
}

/** Short name of a model id for captions: "black-forest-labs/flux.1-schnell" → "flux.1-schnell". */
export function shortModel(id: string): string {
  return id.split('/').pop() ?? id;
}

/**
 * Renders of one entry and the action that makes another from the version on screen. Kept in the
 * entry page so the button (beside Retry) and the strip (below the details) share one state.
 */
export function useVisualize(entryId: string, version: EntryVersion | undefined): VisualizeState {
  const toast = useToast();
  const [renders, setRenders] = useState<Render[]>([]);
  const [choice, setChoice] = useState<Settings['imagine'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const last = useRef<RunOptions | undefined>(undefined);
  const spec = version?.spec.inspi === 'image/1' ? (version.spec as ImageSpec) : null;
  const pending = busy ? sizeFor(spec?.params.aspect_ratio) : null;

  const load = useCallback(async () => {
    try {
      setRenders(await listRenders({ entryId }));
    } catch {
      // keep what is shown
    }
  }, [entryId]);

  useEffect(() => {
    void load();
    void api<{ settings: Settings }>('/api/settings').then((r) => setChoice(r.settings.imagine)).catch(() => {});
    window.addEventListener(RENDERS_CHANGED, load);
    return () => window.removeEventListener(RENDERS_CHANGED, load);
  }, [load]);

  const run = useCallback((picked?: Settings['imagine'], remember = false, options?: RunOptions) => {
    const use = picked ?? choice;
    if (!spec || !version || !use || busy) return;
    if (picked && remember) {
      setChoice(picked);
      void api('/api/settings', { method: 'PUT', json: { imagine: picked } }).catch(() => {});
    }
    // "Try again" repeats the last subject choice; without one, the choice saved in this browser.
    const opts = options ?? last.current ?? savedOptions();
    last.current = opts;
    const target = effectiveChoice(use, cachedImageCatalog()?.value.recommended ?? null);
    setBusy(true);
    setError(null);
    visualize({
      backend: target.backend,
      model: target.model,
      // The whole prompt: the instruction (with the subject choice) plus the JSON spec, which lists what to avoid.
      prompt: composePrompt(spec, opts.subject),
      aspect: spec.params.aspect_ratio,
      entryId,
      versionId: version.id,
      ...(opts.reference && target.backend !== 'keyless-url' ? { reference: true } : {}),
    })
      .then(() => toast.show('Developed: a new render is in Renders'))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'The image could not be made.'))
      .finally(() => setBusy(false));
  }, [spec, version, choice, busy, entryId, toast]);

  const remove = useCallback(
    async (render: Render) => {
      try {
        await deleteRender(render.id);
        toast.show('Render deleted');
      } catch (e) {
        toast.show(e instanceof Error ? e.message : 'That did not work.', { tone: 'error' });
      }
    },
    [toast],
  );

  return { renders, busy, error, pending, choice, spec, entryId, versionId: version?.id ?? null, run, remove };
}

/** The Visualize button beside Retry: opens a small window to pick the subject and model, then makes the image. */
export function VisualizeButton({ state, disabled }: { state: VisualizeState; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <ShutterButton variant="plain" busy={state.busy} disabled={disabled || !state.choice} onClick={() => setOpen(true)}>
        {state.busy ? 'Developing' : 'Visualize'}
      </ShutterButton>
      {state.choice && state.spec && (
        <VisualizeDialog
          open={open}
          onClose={() => setOpen(false)}
          initial={state.choice}
          spec={state.spec}
          entryId={state.entryId}
          versionId={state.versionId}
          onGenerate={(choice, options) => {
            setOpen(false);
            saveOptions(options);
            state.run(choice, true, options);
          }}
        />
      )}
    </>
  );
}

const SUBJECT_OPTIONS = SUBJECT_MODES.map((value) => ({ value, label: SUBJECT_LABELS[value] }));

/** Subjects described in this tab, so reopening the dialog does not ask again. */
const described = new Map<string, string>();

function VisualizeDialog({
  open,
  onClose,
  initial,
  spec,
  entryId,
  versionId,
  onGenerate,
}: {
  open: boolean;
  onClose: () => void;
  initial: Settings['imagine'];
  spec: ImageSpec;
  entryId: string;
  versionId: string | null;
  onGenerate: (choice: Settings['imagine'], options: RunOptions) => void;
}) {
  const [choice, setChoice] = useState(initial);
  const [mode, setMode] = useState<SubjectMode>(DEFAULT_OPTIONS.subject.mode);
  const [reference, setReference] = useState(false);
  const [original, setOriginal] = useState('');
  const [mine, setMine] = useState('');
  const [describing, setDescribing] = useState(false);
  const [describeError, setDescribeError] = useState<string | null>(null);
  const [showPrompt, setShowPrompt] = useState(false);
  const { catalog } = useImageCatalog();

  const describe = useCallback(async () => {
    if (!versionId) return;
    setDescribing(true);
    setDescribeError(null);
    try {
      const { subject } = await api<{ subject: string }>(`/api/entries/${entryId}/subject`, { method: 'POST', json: { versionId } });
      described.set(versionId, subject);
      setOriginal(subject);
    } catch (e) {
      setDescribeError(e instanceof Error ? e.message : 'It could not be described.');
    } finally {
      setDescribing(false);
    }
  }, [entryId, versionId]);

  useEffect(() => {
    if (!open) return;
    setChoice(initial);
    const saved = savedOptions();
    // The entry's own choice first (made when it was added, or on its page), else the last one used
    setMode(spec.subjectMode ?? saved.subject.mode);
    setMine(spec.mySubject ?? '');
    setReference(saved.reference);
    setOriginal((versionId && described.get(versionId)) || spec.subject || '');
    setDescribeError(null);
  }, [open, initial, spec.subject, spec.subjectMode, spec.mySubject, versionId]);

  // Entries made before the analysis kept the subject: describe it once, when Recreate is chosen.
  const needsSubject = open && mode === 'recreate' && !original && !describing && !describeError;
  useEffect(() => {
    if (needsSubject) void describe();
  }, [needsSubject, describe]);

  const target = effectiveChoice(choice, catalog?.recommended ?? null);
  const model = catalog?.backends.flatMap((b) => b.models).find((m) => m.id === target.model) ?? null;
  const canSeeImage = target.backend !== 'keyless-url' && Boolean(model?.acceptsImage);
  const subject: SubjectChoice = mode === 'recreate' ? { mode, text: original } : mode === 'mine' ? { mode, text: mine } : { mode };
  const prompt = composePrompt(spec, subject);
  const blocked = (mode === 'recreate' && !original.trim()) || (mode === 'mine' && !mine.trim());

  return (
    <Modal open={open} onClose={onClose} title="Visualize">
      <p className="text-[0.9375rem] leading-relaxed text-muted">
        Makes an image from this entry&rsquo;s prompt. One try with the model below; if it fails, it says so.
      </p>

      <div className="mt-5">
        <p className="mb-2 text-[0.75rem] font-medium text-muted">Subject</p>
        <Segmented<SubjectMode> label="Subject" size="sm" value={mode} onChange={setMode} options={SUBJECT_OPTIONS} />
        {mode === 'recreate' && (
          <div className="mt-3">
            <textarea
              className="field min-h-[5.5rem] resize-y !text-[0.875rem] leading-relaxed"
              value={original}
              onChange={(e) => setOriginal(e.target.value)}
              placeholder={describing ? 'Describing what the picture shows…' : 'What the picture shows'}
              aria-label="What the picture shows"
              disabled={describing}
            />
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[0.75rem] text-muted">
              <span>Same subject, arrangement and style. Edit it to change details.</span>
              <button
                type="button"
                className="text-ink underline decoration-line underline-offset-4 hover:decoration-accent disabled:opacity-50"
                disabled={describing}
                onClick={() => void describe()}
              >
                {describing ? 'Describing…' : 'Describe it in detail'}
              </button>
            </div>
            {describeError && <p className="mt-1.5 text-[0.8125rem] text-danger">{describeError}</p>}
            <div className={`mt-3 flex items-start gap-3 rounded-xl border border-line p-3 ${canSeeImage ? '' : 'opacity-70'}`}>
              <Switch checked={reference && canSeeImage} onChange={setReference} label="Show the model the original picture" disabled={!canSeeImage} />
              <div className="min-w-0 text-[0.8125rem] leading-snug">
                <p className="font-medium text-head">Show the model the original picture</p>
                <p className="mt-0.5 text-muted">
                  {canSeeImage
                    ? 'Closest to a one-to-one copy. Sends your first picture to Pollinations with the prompt.'
                    : `${model?.label ?? 'This model'} cannot take a picture. GPT Image, MAI Image, FLUX Kontext and FLUX.2 Klein can.`}
                </p>
              </div>
            </div>
          </div>
        )}
        {mode === 'mine' && (
          <div className="mt-3">
            <textarea
              className="field min-h-[4.5rem] resize-y !text-[0.875rem] leading-relaxed"
              value={mine}
              onChange={(e) => setMine(e.target.value)}
              placeholder="A lighthouse on a cliff at dusk"
              aria-label="Your subject"
              autoFocus
            />
            <p className="mt-1.5 text-[0.75rem] text-muted">Your subject, drawn in this entry&rsquo;s style.</p>
          </div>
        )}
        {mode === 'model' && (
          <p className="mt-3 text-[0.8125rem] text-muted">Only the style carries over; the model invents a subject. This is what Copy prompt gives you.</p>
        )}
      </div>

      <button
        type="button"
        className="mt-4 text-[0.8125rem] text-ink underline decoration-line underline-offset-4 hover:decoration-accent"
        onClick={() => setShowPrompt((v) => !v)}
      >
        {showPrompt ? 'Hide the prompt' : 'Show the prompt'}
      </button>
      {showPrompt && (
        <p className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-xl border border-line bg-paper/40 p-3 text-[0.8125rem] leading-relaxed text-ink">
          {prompt}
        </p>
      )}
      <div className="mt-5">
        <ModelSelect value={choice} onChange={setChoice} compact />
      </div>
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="btn" onClick={onClose}>
          Cancel
        </button>
        <ShutterButton disabled={blocked} onClick={() => onGenerate(choice, { subject, reference: reference && canSeeImage })}>
          Generate
        </ShutterButton>
      </div>
    </Modal>
  );
}

/** Renders strip below the entry, with what made each one and a way to delete it. */
export function VisualizePanel({ state, entryName }: { state: VisualizeState; entryName: string }) {
  const [confirming, setConfirming] = useState<Render | null>(null);
  if (!state.renders.length && !state.pending && !state.error) return null;

  const items: StripItem[] = state.renders.map((r) => ({
    id: r.id,
    src: r.url,
    width: r.width,
    height: r.height,
    alt: `${entryName}, rendered with ${shortModel(r.model)}`,
    caption: (
      <span className="truncate" title={r.prompt}>
        {shortModel(r.model)}
      </span>
    ),
  }));

  return (
    <section className="mt-16" aria-labelledby="renders-heading">
      <RenderCarousel
        heading={
          <RevealHeading id="renders-heading" className="display text-[clamp(2rem,4vw,3rem)] leading-none">
            Renders
          </RevealHeading>
        }
        extra={
          state.choice && (
            <Link href="/visualize" className="chip" title="Change the image model on the Visualize page">
              {state.choice.auto ? `AutoPick: ${state.choice.auto}` : state.choice.backend === 'keyless-url' ? 'Keyless URL' : shortModel(state.choice.model)} · change
            </Link>
          )
        }
        notice={
          state.error && (
            <p className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-danger/40 bg-danger/5 px-3.5 py-2.5 text-sm text-ink" role="alert">
              {state.error}
              <button type="button" className="text-ink underline decoration-accent underline-offset-4" onClick={() => state.run()}>
                Try again
              </button>
            </p>
          )
        }
        items={items}
        pending={state.pending}
        actions={(item) => (
          <button
            type="button"
            className="icon-btn ml-auto h-7 w-7 hover:!text-danger"
            aria-label="Delete this render"
            onClick={() => setConfirming(state.renders.find((r) => r.id === item.id) ?? null)}
          >
            <TrashIcon size={14} />
          </button>
        )}
      />
      <Modal
        open={confirming !== null}
        onClose={() => setConfirming(null)}
        title="Delete this render?"
      >
        <p className="text-ink">The image file is removed from your library folder. This cannot be undone.</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => setConfirming(null)}>
            Keep it
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              if (confirming) void state.remove(confirming);
              setConfirming(null);
            }}
          >
            <TrashIcon size={16} />
            Delete
          </button>
        </div>
      </Modal>
    </section>
  );
}
