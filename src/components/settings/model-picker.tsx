'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ProviderId } from '@/lib/ai/client';
import type { ListedModel, ModelListing } from '@/lib/ai/status';
import { api } from '@/lib/client/api';
import { modelsKey, readCache, writeCache } from '@/lib/client/model-cache';

/** Asks the server for a provider's models and keeps a good answer in the browser. */
export async function fetchModelListing(id: ProviderId): Promise<ModelListing> {
  const found = await api<ModelListing>(`/api/providers/models?provider=${id}`);
  if (found.ok) writeCache(modelsKey(id), found);
  return found;
}

/**
 * The models a provider offers. A list kept in the browser draws at once; it is only fetched when
 * missing or older than a few hours (the site fetches them all when it opens). `check` refetches.
 */
export function useModelListing(id: ProviderId, hasKey: boolean) {
  const [listing, setListing] = useState<ModelListing | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setListing(null);
    if (!hasKey) return;
    const cached = readCache<ModelListing>(modelsKey(id));
    if (cached) setListing(cached.value);
    if (cached?.fresh) return;
    let cancelled = false;
    fetchModelListing(id)
      .then((found) => !cancelled && setListing(found))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, hasKey]);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setListing(await fetchModelListing(id));
    } catch (error) {
      setListing({ ok: false, models: [], message: error instanceof Error ? error.message : 'The check failed.' });
    } finally {
      setChecking(false);
    }
  }, [id]);

  return { listing, checking, check };
}

export interface ModelGroup {
  /** Empty when the provider's models are not split into groups. */
  label: string;
  ids: string[];
}

/** Which listed models suit each job. OpenRouter's free models come first, its paid ones after. */
export function modelChoices(id: ProviderId, listing: ModelListing | null): { vision: ModelGroup[]; text: ModelGroup[] } {
  const usable = listing?.ok ? listing.models : [];
  // Some providers do not say which models read images; then every chat model is offered.
  const readers = usable.filter((m) => m.vision === true);
  const vision = readers.length ? readers : usable.filter((m) => m.vision !== false);

  const group = (models: ListedModel[]): ModelGroup[] => {
    if (id === 'pollinations') {
      // Pollinations measures its (often community-run) models; flaky ones sink to the bottom.
      const byHealth = (health: ListedModel['health']) => models.filter((m) => (m.health ?? 'unknown') === health).map((m) => m.id);
      return [
        { label: 'Healthy', ids: byHealth('healthy') },
        { label: 'Degraded: often fails', ids: byHealth('degraded') },
        { label: 'Not measured yet', ids: byHealth('unknown') },
      ].filter((g) => g.ids.length);
    }
    if (id !== 'openrouter') return models.length ? [{ label: '', ids: models.map((m) => m.id) }] : [];
    const free = (m: ListedModel) => m.free === true || m.id.endsWith(':free');
    return [
      { label: 'Free', ids: models.filter(free).map((m) => m.id) },
      { label: 'Paid: uses OpenRouter credit', ids: models.filter((m) => !free(m)).map((m) => m.id) },
    ].filter((g) => g.ids.length);
  };
  return { vision: group(vision), text: group(usable) };
}

/**
 * A dropdown of the models the provider offers. While the list loads it is the same dropdown with
 * just the current model in it, so nothing on the page moves when the list arrives. Only when the
 * list cannot be had does it become a text box, so a model id can still be typed in.
 */
export function ModelPicker({
  label,
  value,
  choices,
  fallback,
  listed,
  failed = false,
  onChange,
}: {
  label: string;
  value: string;
  choices: ModelGroup[];
  fallback: string;
  listed: boolean;
  /** The list could not be fetched: offer a text box instead. */
  failed?: boolean;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const listedIds = choices.flatMap((g) => g.ids);
  // Keep the chosen model and the default selectable even when the provider no longer lists them.
  const unlisted = [...new Set([fallback, value])].filter((id) => id && !listedIds.includes(id));
  const option = (id: string) => (
    <option key={id} value={id}>
      {id}
    </option>
  );

  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-medium text-head">{label}</span>
      {!failed ? (
        <>
          <select className="field font-mono !text-[0.8125rem]" value={value} onChange={(e) => onChange(e.target.value)}>
            {/* Without this, an empty choice would show the first model as if it were picked. */}
            {!value && (
              <option value="" disabled>
                Pick a model…
              </option>
            )}
            {unlisted.map(option)}
            {(listed ? choices : []).map((g) =>
              g.label ? (
                <optgroup key={g.label} label={g.label}>
                  {g.ids.map(option)}
                </optgroup>
              ) : (
                g.ids.map(option)
              ),
            )}
          </select>
          {listed && listedIds.length <= 1 && (
            <span className="mt-1.5 block text-xs text-muted">This provider has no other model for this job.</span>
          )}
        </>
      ) : (
        <input
          className="field font-mono !text-[0.8125rem]"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => draft.trim() !== value && onChange(draft.trim())}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          placeholder={fallback || 'Loading the list…'}
          spellCheck={false}
        />
      )}
    </label>
  );
}
