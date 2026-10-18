'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/feedback/toast';
import { MasonryWall, type StripItem } from '@/components/fx/library';
import { CopyButton } from '@/components/ui/copy-button';
import { TrashIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { Segmented } from '@/components/ui/segmented';
import { api } from '@/lib/client/api';
import { cachedImageCatalog, deleteRender, effectiveChoice, listRenders, RENDERS_CHANGED, visualize } from '@/lib/client/imagine';
import { sizeFor } from '@/lib/imagine/size';
import type { BackendId } from '@/lib/imagine/types';
import type { Settings } from '@/lib/settings';
import type { Render } from '@/lib/types';
import { shortModel } from '../entry/visualize-panel';
import { Playground, type Draft } from './playground';

type Filter = 'all' | BackendId;
const PAGE = 40;

export function VisualizeView() {
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>({ prompt: '', negative: '', aspect: '1:1', from: null });
  const [choice, setChoice] = useState<Settings['imagine'] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>('all');
  const [renders, setRenders] = useState<Render[]>([]);
  const [more, setMore] = useState(true);
  const [confirming, setConfirming] = useState<Render | null>(null);
  const sentinel = useRef<HTMLDivElement>(null);
  const aside = useRef<HTMLElement>(null);

  // The column is as tall as the screen below its top edge: below the title at first, the whole
  // screen once it sticks. So Generate, at its foot, is on screen from the first view.
  useEffect(() => {
    const el = aside.current;
    if (!el) return;
    let frame = 0;
    const fit = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const top = Math.max(24, el.getBoundingClientRect().top);
        el.style.setProperty('--aside-max', `${Math.max(320, window.innerHeight - top - 24)}px`);
      });
    };
    fit();
    window.addEventListener('scroll', fit, { passive: true });
    window.addEventListener('resize', fit);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('scroll', fit);
      window.removeEventListener('resize', fit);
    };
  }, [choice]);
  const loading = useRef(false);

  useEffect(() => {
    void api<{ settings: Settings }>('/api/settings').then((r) => setChoice(r.settings.imagine)).catch(() => {});
  }, []);

  const backend = filter === 'all' ? undefined : filter;
  const reload = useCallback(async () => {
    const items = await listRenders({ backend }).catch(() => [] as Render[]);
    setRenders(items);
    setMore(items.length === PAGE);
  }, [backend]);

  useEffect(() => {
    void reload();
    window.addEventListener(RENDERS_CHANGED, reload);
    return () => window.removeEventListener(RENDERS_CHANGED, reload);
  }, [reload]);

  // Infinite scroll: the next page loads as the end of the wall comes into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !more) return;
    const observer = new IntersectionObserver(async ([hit]) => {
      if (!hit.isIntersecting || loading.current) return;
      loading.current = true;
      const next = await listRenders({ backend, offset: renders.length }).catch(() => [] as Render[]);
      setRenders((current) => [...current, ...next.filter((n) => !current.some((c) => c.id === n.id))]);
      setMore(next.length === PAGE);
      loading.current = false;
    }, { rootMargin: '600px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [more, backend, renders.length]);

  async function saveChoice(next: Settings['imagine']) {
    setChoice(next);
    try {
      await api('/api/settings', { method: 'PUT', json: { imagine: next } });
    } catch (e) {
      toast.show(e instanceof Error ? e.message : 'The choice was not saved.', { tone: 'error' });
    }
  }

  const acceptsImage = (id: string) => Boolean(cachedImageCatalog()?.value.backends.flatMap((b) => b.models).find((m) => m.id === id)?.acceptsImage);

  function generate() {
    if (!choice || busy || !draft.prompt.trim()) return;
    const target = effectiveChoice(choice, cachedImageCatalog()?.value.recommended ?? null);
    setBusy(true);
    setError(null);
    visualize({
      backend: target.backend,
      model: target.model,
      prompt: draft.prompt,
      negative: draft.negative || undefined,
      aspect: draft.aspect,
      entryId: draft.from?.entryId,
      versionId: draft.from?.versionId,
      // Only for a model that takes a picture (the switch is off otherwise); never by the keyless route
      ...(draft.from && draft.reference && target.backend !== 'keyless-url' && acceptsImage(target.model) ? { reference: true } : {}),
    })
      .then(() => toast.show('Developed'))
      .catch((e: unknown) => setError(e instanceof Error ? e.message : 'The image could not be made.'))
      .finally(() => setBusy(false));
  }

  const items: StripItem[] = renders.map((r) => ({
    id: r.id,
    src: r.url,
    width: r.width,
    height: r.height,
    alt: r.prompt.slice(0, 80),
    caption: (
      <span className="min-w-0 truncate">
        {r.backend === 'keyless-url' ? 'keyless' : shortModel(r.model)}
        {r.entrySlug && (
          <>
            {' · '}
            <Link href={`/e/${r.entrySlug}`} className="text-ink underline decoration-line underline-offset-4 hover:decoration-accent">
              {r.entryName}
            </Link>
          </>
        )}
      </span>
    ),
  }));
  const byId = new Map(renders.map((r) => [r.id, r]));

  return (
    <div className="px-4 pt-4 sm:px-8">
      <h1 className="display text-[clamp(2.5rem,5vw,4rem)] leading-none">Visualize</h1>
      <p className="mt-3 max-w-[38rem] text-[1.0625rem] leading-relaxed text-ink">
        Turn a prompt into an image. Image entries have a Visualize button that does this with their own prompt; here you can write
        your own or borrow one.
      </p>

      <div className="mt-10 grid grid-cols-[minmax(0,1fr)] items-start gap-10 lg:grid-cols-[minmax(0,26rem)_minmax(0,1fr)] lg:gap-14">
        {/* Capped to the screen and scrolled on its own (not the wall), so every model is reachable from anywhere on the page */}
        <aside ref={aside} className="quiet-scroll lg:sticky lg:top-6 lg:max-h-[var(--aside-max,calc(100dvh-3rem))] lg:overflow-y-auto lg:overscroll-contain lg:pr-2">
          {choice ? (
            <Playground draft={draft} setDraft={setDraft} choice={choice} onChoice={saveChoice} busy={busy} error={error} onGenerate={generate} />
          ) : (
            <p className="text-muted">Loading…</p>
          )}
        </aside>

        <section aria-label="Renders">
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
            <h2 className="display text-[1.75rem] leading-tight">Every render</h2>
            <Segmented<Filter>
              label="Show renders from"
              size="sm"
              value={filter}
              onChange={setFilter}
              options={[
                { value: 'all', label: 'All' },
                { value: 'pollinations', label: 'Pollinations' },
                { value: 'pollinations-community', label: 'Community' },
                { value: 'keyless-url', label: 'Keyless' },
              ]}
            />
          </div>
          {renders.length === 0 && !busy ? (
            <div className="grid place-items-center rounded-2xl border border-dashed border-line px-6 py-20 text-center">
              <p className="display text-[1.5rem] text-head">Nothing developed yet</p>
              <p className="mt-2 max-w-[24rem] text-sm text-muted">Write a prompt, or borrow one from an entry, and press Generate.</p>
            </div>
          ) : (
            <MasonryWall
              items={items}
              pending={busy ? sizeFor(draft.aspect) : null}
              actions={(item) => (
                <button
                  type="button"
                  className="icon-btn ml-auto h-7 w-7 shrink-0 hover:!text-danger"
                  aria-label="Delete this render"
                  onClick={() => setConfirming(byId.get(item.id) ?? null)}
                >
                  <TrashIcon size={14} />
                </button>
              )}
              footer={(item, closeView) => {
                const r = byId.get(item.id);
                if (!r) return null;
                return (
                  <div>
                    <div className="fx-side-actions">
                      <CopyButton variant="plain" label="Copy prompt" text={() => r.prompt}>
                        Copy prompt
                      </CopyButton>
                      <button
                        type="button"
                        className="btn"
                        onClick={() => {
                          setDraft({ ...draft, prompt: r.prompt, aspect: `${r.width}:${r.height}`, from: null });
                          closeView();
                          // After the view has closed, take the person to the prompt they just filled.
                          window.setTimeout(() => {
                            const box = document.getElementById('viz-prompt');
                            box?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                            box?.focus({ preventScroll: true });
                          }, 120);
                        }}
                      >
                        Use this prompt
                      </button>
                      <span className="text-[0.75rem] text-muted">
                        {shortModel(r.model)} · {r.width}×{r.height}
                      </span>
                    </div>
                    <p className="mt-3 whitespace-pre-wrap">{r.prompt}</p>
                  </div>
                );
              }}
            />
          )}
          <div ref={sentinel} aria-hidden className="h-px" />
        </section>
      </div>

      <Modal open={confirming !== null} onClose={() => setConfirming(null)} title="Delete this render?">
        <p className="text-ink">The image file is removed from your library folder. This cannot be undone.</p>
        <div className="mt-6 flex justify-end gap-2">
          <button type="button" className="btn" onClick={() => setConfirming(null)}>
            Keep it
          </button>
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => {
              const target = confirming;
              setConfirming(null);
              if (target) void deleteRender(target.id).then(() => toast.show('Render deleted')).catch((e: unknown) => toast.show(e instanceof Error ? e.message : 'That did not work.', { tone: 'error' }));
            }}
          >
            <TrashIcon size={16} />
            Delete
          </button>
        </div>
      </Modal>
    </div>
  );
}
