'use client';

import { useEffect, useState } from 'react';
import { HealthDot } from '@/components/fx/library';
import { CheckIcon } from '@/components/ui/icons';
import { Segmented } from '@/components/ui/segmented';
import { cachedImageCatalog, imageCatalog, type ImageCatalog } from '@/lib/client/imagine';
import { AUTO_MODES, MODEL_FACTS, STRONGEST_FIRST, type AutoMode } from '@/lib/imagine/recommend';
import type { BackendId } from '@/lib/imagine/types';
import type { Settings } from '@/lib/settings';

type Choice = Settings['imagine'];

const SHORT: Record<BackendId, string> = {
  pollinations: 'Pollinations',
  'pollinations-community': 'Community',
  'keyless-url': 'Keyless',
};

const MODE_TEXT: Record<AutoMode, { title: string; why: string }> = {
  strongest: { title: 'Strongest', why: 'best rated' },
  balanced: { title: 'Balanced', why: 'best for its price and wait' },
  cheapest: { title: 'Cheapest', why: 'least Pollen' },
};

/**
 * The image catalogue: drawn from the browser's copy at once, refreshed from the server when old.
 * The site fetches it when it opens, so this rarely waits.
 */
export function useImageCatalog(): { catalog: ImageCatalog | null; error: string | null } {
  const [catalog, setCatalog] = useState<ImageCatalog | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const cached = cachedImageCatalog();
    if (cached) setCatalog(cached.value);
    if (cached?.fresh) return;
    imageCatalog()
      .then(setCatalog)
      .catch((e: unknown) => !cached && setError(e instanceof Error ? e.message : 'The model lists could not be read.'));
  }, []);
  return { catalog, error };
}

const label = (catalog: ImageCatalog | null, id: string | null | undefined) =>
  id ? (catalog?.backends.flatMap((b) => b.models).find((m) => m.id === id)?.label ?? id.split('/').pop() ?? id) : null;

const rank = (id: string) => {
  const i = STRONGEST_FIRST.indexOf(id);
  return i < 0 ? STRONGEST_FIRST.length : i;
};

/**
 * AutoPick (Strongest, Balanced, Cheapest: each names the model it would use now), or a backend
 * and a model. Health is Pollinations' own measurement; price and time are on each ranked model.
 */
export function ModelSelect({ value, onChange, compact = false }: { value: Choice; onChange: (next: Choice) => void; compact?: boolean }) {
  const { catalog, error } = useImageCatalog();
  const backend = catalog?.backends.find((b) => b.id === value.backend);
  const models = [...(backend?.models ?? [])].sort((a, b) => rank(a.id) - rank(b.id) || a.label.localeCompare(b.label));

  function pickBackend(id: BackendId) {
    const listing = catalog?.backends.find((b) => b.id === id);
    const first = [...(listing?.models ?? [])].sort((a, b) => rank(a.id) - rank(b.id))[0]?.id ?? 'default';
    onChange({ backend: id, model: id === 'keyless-url' ? 'default' : first, auto: false });
  }

  return (
    <div>
      <p className="text-[0.8125rem] font-medium text-head">AutoPick model</p>
      <div role="radiogroup" aria-label="AutoPick model" className="mt-2 grid grid-cols-3 gap-1.5">
        {AUTO_MODES.map((mode) => {
          const on = value.auto === mode;
          const pick = label(catalog, catalog?.recommended[mode]);
          return (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={on}
              onClick={() => onChange({ ...value, auto: mode })}
              className={`relative min-w-0 rounded-xl border px-2.5 py-2 text-left transition-colors ${
                on ? 'border-accent bg-accent/10 text-head ring-1 ring-accent' : 'border-line text-ink hover:border-muted'
              }`}
            >
              {on && <CheckIcon size={13} strokeWidth={2.4} className="absolute right-2 top-2 text-accent" />}
              <span className="block text-[0.8125rem] font-semibold">{MODE_TEXT[mode].title}</span>
              <span className="block truncate text-[0.6875rem] text-muted">{pick ?? MODE_TEXT[mode].why}</span>
            </button>
          );
        })}
      </div>

      <p className="mt-4 text-[0.8125rem] font-medium text-head">Or pick one</p>
      <div className="mt-2">
        <Segmented
          label="Image backend"
          size="sm"
          value={value.backend}
          onChange={pickBackend}
          options={(['pollinations', 'pollinations-community', 'keyless-url'] as BackendId[]).map((id) => ({ value: id, label: SHORT[id] }))}
        />
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}
      {backend && (backend.experimental || !backend.available) && (
        <p className="mt-2 text-[0.8125rem] leading-snug text-muted">
          {backend.experimental && <span className="badge mr-1.5">experimental</span>}
          {backend.message}
        </p>
      )}

      {backend?.available && backend.id !== 'keyless-url' && (
        <div
          role="radiogroup"
          aria-label="Image model"
          className={`mt-2.5 space-y-1 overflow-y-auto rounded-xl border border-line bg-paper/40 p-1 ${compact ? 'h-[13rem]' : 'h-[16rem]'}`}
        >
          {models.map((m) => {
            const selected = !value.auto && m.id === value.model;
            const facts = MODEL_FACTS[m.id];
            return (
              <button
                key={m.id}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => onChange({ backend: backend.id, model: m.id, auto: false })}
                className={`flex w-full items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                  selected ? 'border-accent bg-accent/10 text-head ring-1 ring-accent' : 'border-transparent text-ink hover:bg-surface/70'
                }`}
              >
                <HealthDot health={m.health} title={m.successRate !== null ? `${m.health}, ${m.successRate}% of recent requests worked` : m.health} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.875rem] font-medium">{m.label}</span>
                  <span className="block truncate font-mono text-[0.6875rem] text-muted">
                    {facts ? `≈${facts.pollen} Pollen · ${facts.seconds} s${facts.elo ? ` · rated ${facts.elo}` : ''}` : m.id}
                  </span>
                </span>
                {m.acceptsImage && (
                  <span className="badge shrink-0" title="Can take a reference image">
                    ref
                  </span>
                )}
                {selected ? (
                  <CheckIcon size={16} strokeWidth={2.4} className="shrink-0 text-accent" />
                ) : (
                  m.successRate !== null && <span className="shrink-0 text-[0.75rem] tabular-nums text-muted">{m.successRate}%</span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
