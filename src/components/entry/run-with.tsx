'use client';

import { useEffect, useState } from 'react';
import { ModelPicker, modelChoices, useModelListing } from '@/components/settings/model-picker';
import type { ProviderId } from '@/lib/ai/client';
import type { ProviderStatus } from '@/lib/ai/status';
import { api } from '@/lib/client/api';
import type { Settings } from '@/lib/settings';
import type { RunChoice } from '@/lib/types';

interface Payload {
  settings: Settings;
  providers: ProviderStatus[];
}

/**
 * Which provider and models one run uses. It starts on the provider in use with its saved
 * models; anything changed applies to this run only. Still one provider, never a fallback.
 * Reports null while nothing differs from the provider in use, and whether a reading model is set.
 * Shared by the Retry dialog's fieldset (RunWith) and the New entry window's button (RunButton).
 */
export function useRunChoice(open: boolean, onChange: (run: RunChoice | null, ready: boolean) => void) {
  const [data, setData] = useState<Payload | null>(null);
  const [provider, setProvider] = useState<ProviderId | null>(null);
  const [vision, setVision] = useState('');
  const [text, setText] = useState('');

  useEffect(() => {
    if (!open) return;
    api<Payload>('/api/settings')
      .then((payload) => {
        setData(payload);
        const inUse = payload.providers.find((p) => p.usable) ?? payload.providers.find((p) => p.hasKey);
        if (inUse) {
          setProvider(inUse.id);
          setVision(inUse.visionModel);
          setText(inUse.textModel);
        }
      })
      .catch(() => {});
  }, [open]);

  const keyed = data?.providers.filter((p) => p.hasKey) ?? [];
  const current = keyed.find((p) => p.id === provider);
  const inUse = data?.providers.find((p) => p.usable);
  const { listing } = useModelListing(provider ?? 'groq', Boolean(current));
  const choices = provider ? modelChoices(provider, listing) : { vision: [], text: [] };
  const changed = provider !== inUse?.id || vision !== inUse?.visionModel || text !== inUse?.textModel;

  useEffect(() => {
    if (!provider || !inUse) return onChange(null, true);
    const same = provider === inUse.id && vision === inUse.visionModel && text === inUse.textModel;
    onChange(same ? null : { provider, ...(vision ? { vision } : {}), ...(text ? { text } : {}) }, Boolean(vision));
    // onChange is a fresh closure each render of the parent; only the choice matters here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [provider, vision, text, inUse?.id, inUse?.visionModel, inUse?.textModel]);

  function pick(id: ProviderId) {
    const next = keyed.find((p) => p.id === id);
    setProvider(id);
    setVision(next?.visionModel ?? '');
    setText(next?.textModel ?? '');
  }

  return { ready: Boolean(data && current), keyed, current, inUse, listing, choices, vision, text, setVision, setText, pick, changed };
}

export type RunChoiceState = ReturnType<typeof useRunChoice>;

/** The two model pickers for the provider picked, with the line that says what this run does. */
export function RunModels({ run, stacked = false }: { run: RunChoiceState; stacked?: boolean }) {
  const { current, listing, choices, vision, text, setVision, setText, changed } = run;
  if (!current) return null;
  return (
    <>
      <div className={`mt-3 grid gap-3 ${stacked ? '' : 'sm:grid-cols-2'}`}>
        <ModelPicker label="Reads the image" value={vision} choices={choices.vision} fallback={current.defaultVision} listed={Boolean(listing?.ok)} failed={listing?.ok === false} onChange={setVision} />
        <ModelPicker label="Writes the spec" value={text} choices={choices.text} fallback={current.defaultText} listed={Boolean(listing?.ok)} failed={listing?.ok === false} onChange={setText} />
      </div>
      <p className="mt-2.5 text-[0.8125rem] leading-snug text-muted">
        {changed ? 'For this run only. If it fails, it says so; nothing else is tried.' : 'The provider in use, with its saved models.'}
        {!vision && ' Pick a model that reads images first.'}
      </p>
    </>
  );
}

/** The Retry dialog's "Run with" fieldset: provider and models for this run. */
export function RunWith({ open, onChange }: { open: boolean; onChange: (run: RunChoice | null, ready: boolean) => void }) {
  const run = useRunChoice(open, onChange);
  const { ready, keyed, current, inUse, pick } = run;
  if (!ready || !current) return null;

  return (
    <fieldset className="mt-5 rounded-xl border border-line p-3.5">
      <legend className="px-1 text-sm font-medium text-head">Run with</legend>
      <label className="block">
        <span className="mb-1.5 block text-sm font-medium text-head">Provider</span>
        <select className="field" value={current.id} onChange={(e) => pick(e.target.value as ProviderId)}>
          {keyed.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
              {p.id === inUse?.id ? '  (in use)' : ''}
            </option>
          ))}
        </select>
      </label>
      <RunModels run={run} />
    </fieldset>
  );
}
