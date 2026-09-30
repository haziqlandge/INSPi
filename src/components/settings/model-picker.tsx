'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ProviderId } from '@/lib/ai/client';
import type { ModelListing } from '@/lib/ai/status';
import { api } from '@/lib/client/api';

/**
 * The models a provider offers. The list costs no tokens, so it is fetched as soon as a keyed
 * provider is shown; `check` fetches it again.
 */
export function useModelListing(id: ProviderId, hasKey: boolean) {
  const [listing, setListing] = useState<ModelListing | null>(null);
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    setListing(null);
    if (!hasKey) return;
    let cancelled = false;
    api<ModelListing>(`/api/providers/models?provider=${id}`)
      .then((found) => !cancelled && setListing(found))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [id, hasKey]);

  const check = useCallback(async () => {
    setChecking(true);
    try {
      setListing(await api<ModelListing>(`/api/providers/models?provider=${id}`));
    } catch (error) {
      setListing({ ok: false, models: [], message: error instanceof Error ? error.message : 'The check failed.' });
    } finally {
      setChecking(false);
    }
  }, [id]);

  return { listing, checking, check };
}

/** Which listed models suit each job. */
export function modelChoices(id: ProviderId, listing: ModelListing | null): { vision: string[]; text: string[] } {
  // OpenRouter lists paid models too; only its ':free' ones cost nothing.
  const usable = listing?.ok ? listing.models.filter((m) => id !== 'openrouter' || m.id.endsWith(':free')) : [];
  // Some providers do not say which models read images; then every chat model is offered.
  const readers = usable.filter((m) => m.vision === true);
  const vision = (readers.length ? readers : usable.filter((m) => m.vision !== false)).map((m) => m.id);
  return { vision, text: usable.map((m) => m.id) };
}

/**
 * A dropdown of the models the provider offers. Until the list has loaded (or if it cannot be
 * had) it falls back to a text box, so a model id can still be typed in.
 */
export function ModelPicker({
  label,
  value,
  choices,
  fallback,
  listed,
  onChange,
}: {
  label: string;
  value: string;
  choices: string[];
  fallback: string;
  listed: boolean;
  onChange: (next: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  const options = [...choices];
  // Keep the chosen model selectable even when the provider no longer lists it.
  if (value && !options.includes(value)) options.unshift(value);
  if (fallback && !options.includes(fallback)) options.unshift(fallback);

  return (
    <label className="block min-w-0">
      <span className="mb-1.5 block text-sm font-medium text-head">{label}</span>
      {listed ? (
        <select className="field font-mono !text-[0.8125rem]" value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((id) => (
            <option key={id} value={id}>
              {id}
              {id === fallback ? '  (default)' : ''}
            </option>
          ))}
        </select>
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
