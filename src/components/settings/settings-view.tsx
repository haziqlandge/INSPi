'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { useToast } from '@/components/feedback/toast';
import { ArrowDownIcon, ArrowUpIcon } from '@/components/ui/icons';
import { AutoHeight } from '@/components/ui/collapse';
import { Segmented, Switch } from '@/components/ui/segmented';
import type { ProviderId } from '@/lib/ai/client';
import type { ModelListing, ProviderStatus } from '@/lib/ai/status';
import { api } from '@/lib/client/api';
import Link from 'next/link';
import { ModelSelect, useImageCatalog } from '@/components/visualize/model-select';
import { SETTINGS_TABS, TAB_LABELS, tabFrom, type SettingsTab } from './tabs';
import { CodingAgents } from './coding-agents';
import { ModelPicker, modelChoices, useModelListing } from './model-picker';
import type { Settings } from '@/lib/settings';

interface Payload {
  settings: Settings;
  providers: ProviderStatus[];
}

function statusOf(p: ProviderStatus): { text: string; tone: 'ok' | 'off' | 'warn' } {
  if (!p.hasKey) return { text: 'No key', tone: 'off' };
  if (!p.visionModel) return { text: 'Pick a model', tone: 'warn' };
  return { text: 'Ready', tone: 'ok' };
}

function Quota({ provider }: { provider: ProviderStatus }) {
  const rate = provider.rate;
  if (!rate || rate.remainingTokens == null || !rate.limitTokens) return null;
  const share = Math.max(0, Math.min(1, rate.remainingTokens / rate.limitTokens));
  return (
    <div className="mt-4">
      <div className="flex items-baseline justify-between text-[0.8125rem] text-muted">
        <span>Tokens left this minute, at the last call</span>
        <span className="tabular-nums text-ink">
          {rate.remainingTokens.toLocaleString('en')} of {rate.limitTokens.toLocaleString('en')}
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" role="presentation">
        <div className="h-full rounded-full bg-accent transition-[width] duration-500" style={{ width: `${share * 100}%` }} />
      </div>
      {rate.remainingRequests != null && (
        <p className="mt-1.5 text-[0.8125rem] text-muted">
          <span className="tabular-nums text-ink">{rate.remainingRequests.toLocaleString('en')}</span> requests left today.
        </p>
      )}
    </div>
  );
}

function ProviderCard({
  provider,
  inUse,
  place,
  onUse,
  onMove,
  onModels,
}: {
  provider: ProviderStatus;
  inUse: boolean;
  /** Position in the person's order, 1-based, and how many there are. */
  place: { n: number; of: number };
  onUse: () => void;
  onMove: (delta: -1 | 1) => void;
  onModels: (models: { vision: string; text: string }) => void;
}) {
  const [vision, setVision] = useState(provider.visionModel);
  const [text, setText] = useState(provider.textModel);
  const status = statusOf(provider);

  useEffect(() => {
    setVision(provider.visionModel);
    setText(provider.textModel);
  }, [provider.visionModel, provider.textModel]);

  const { listing, checking, check } = useModelListing(provider.id, provider.hasKey);
  const choices = modelChoices(provider.id, listing);

  return (
    <li className="rounded-2xl border border-line bg-surface p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <h3 className="display text-[1.5rem] leading-tight">{provider.label}</h3>
            <span
              className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${
                status.tone === 'ok'
                  ? 'bg-accent/15 text-accent'
                  : status.tone === 'warn'
                    ? 'bg-danger/10 text-danger'
                    : 'bg-line/70 text-muted'
              }`}
            >
              {status.text}
            </span>
            {inUse && <span className="rounded-full bg-head px-2.5 py-0.5 text-xs font-medium text-paper">In use</span>}
            {!inUse && provider.usable && (
              <button type="button" className="text-[0.8125rem] text-ink underline decoration-accent underline-offset-4" onClick={onUse}>
                Use this one
              </button>
            )}
          </div>
          <p className="mt-1.5 text-[0.9375rem] text-muted">{provider.note}</p>
          {provider.hasFallbackKey && (
            <p className="mt-1 text-[0.8125rem] text-muted">A second key is set: it takes over while the first waits for its quota or is out of it.</p>
          )}
          {provider.duplicateFallbackKey && (
            <p className="mt-1 text-[0.8125rem] text-danger">
              The second key in .env is the same key as the first, so it adds no quota. Paste a key from your other account.
            </p>
          )}

          {!provider.hasKey && (
            <p className="mt-3 text-[0.9375rem] text-ink">
              Add {provider.keyEnv.map((name, i) => (
                <span key={name}>
                  {i > 0 && ' and '}
                  <code className="rounded bg-paper px-1.5 py-0.5 font-mono text-[0.8125rem]">{name}</code>
                </span>
              ))}{' '}
              to the <code className="font-mono text-[0.8125rem]">.env</code> file and restart the server.{' '}
              <a href={provider.keyUrl} target="_blank" rel="noreferrer" className="underline decoration-accent underline-offset-4">
                Get a free key
              </a>
            </p>
          )}

          {provider.hasKey && (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                <ModelPicker
                  label="Model that reads images"
                  value={vision}
                  choices={choices.vision}
                  fallback={provider.defaultVision}
                  listed={Boolean(listing?.ok)} failed={listing?.ok === false}
                  onChange={(next) => {
                    setVision(next);
                    onModels({ vision: next, text });
                  }}
                />
                <ModelPicker
                  label="Model that writes the spec"
                  value={text}
                  choices={choices.text}
                  fallback={provider.defaultText || provider.defaultVision}
                  listed={Boolean(listing?.ok)} failed={listing?.ok === false}
                  onChange={(next) => {
                    setText(next);
                    onModels({ vision, text: next });
                  }}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-2">
                <button type="button" className="btn px-3.5 py-2" onClick={check} disabled={checking}>
                  {checking ? 'Checking…' : 'Refresh the list'}
                </button>
                {(provider.visionModel !== provider.defaultVision || provider.textModel !== (provider.defaultText || provider.visionModel)) &&
                  provider.defaultVision && (
                    <button type="button" className="btn px-3.5 py-2" onClick={() => onModels({ vision: '', text: '' })}>
                      Use the defaults
                    </button>
                  )}
              </div>

              {listing && <p className={`mt-3 text-sm ${listing.ok ? 'text-muted' : 'text-danger'}`}>{listing.message}</p>}
              {listing?.ok && vision && !listing.models.some((m) => m.id === vision) && (
                <p className="mt-1 text-sm text-danger">
                  “{vision}” is not in that list. It may have been retired; pick another model.
                </p>
              )}
              {!provider.verified && (
                <p className="mt-3 text-[0.8125rem] text-muted">
                  This provider&apos;s limits are assumed, not yet confirmed against a live key.
                </p>
              )}
              <Quota provider={provider} />
            </>
          )}
        </div>
        {/* Just the arrows (user, 5 Oct); the position is still read out to screen readers */}
        <div role="group" className="-mr-1.5 -mt-1 flex shrink-0 flex-col items-center" aria-label={`${provider.label}: number ${place.n} of ${place.of}`}>
          <button type="button" className="icon-btn h-8 w-8" onClick={() => onMove(-1)} disabled={place.n === 1} aria-label={`Move ${provider.label} up`}>
            <ArrowUpIcon size={16} />
          </button>
          <button type="button" className="icon-btn h-8 w-8" onClick={() => onMove(1)} disabled={place.n === place.of} aria-label={`Move ${provider.label} down`}>
            <ArrowDownIcon size={16} />
          </button>
        </div>
      </div>
    </li>
  );
}

export function SettingsView() {
  const toast = useToast();
  // The tab lives in the address (?tab=mcp), so links can open a tab and Back is not cluttered
  const params = useSearchParams();
  const tab = tabFrom(`?${params?.toString() ?? ''}`);
  const chooseTab = (next: SettingsTab) => window.history.replaceState(null, '', next === 'analysis' ? '/settings' : `/settings?tab=${next}`);
  const [data, setData] = useState<Payload | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Payload>('/api/settings'));
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'Settings could not be loaded.', { tone: 'error' });
    }
  }, [toast]);

  useEffect(() => {
    void load();
  }, [load]);

  async function save(patch: Partial<Settings>, message = 'Settings saved') {
    try {
      setData(await api<Payload>('/api/settings', { method: 'PUT', json: patch }));
      toast.show(message);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'That could not be saved.', { tone: 'error' });
    }
  }

  if (!data) return <div className="px-4 pt-6 text-muted sm:px-8">Loading settings…</div>;

  const { settings, providers } = data;

  const inUseId = providers.find((p) => p.usable)?.id;

  function use(id: ProviderId) {
    const order = [id, ...settings.order.filter((other) => other !== id)];
    void save({ order }, `${providers.find((p) => p.id === id)?.label} is now in use`);
  }

  function move(id: ProviderId, delta: -1 | 1) {
    const order = [...settings.order];
    const from = order.indexOf(id);
    const to = from + delta;
    if (to < 0 || to >= order.length) return;
    [order[from], order[to]] = [order[to], order[from]];
    void save({ order }, 'Order saved');
  }

  return (
    <div className="mx-auto max-w-3xl px-4 pt-6 sm:px-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="display text-[clamp(2.5rem,5vw,4rem)] leading-none">Settings</h1>
        {/* Phones have no room for the Usage icon in the header; this is the way there. */}
        <Link href="/usage" className="chip sm:hidden">
          Usage
        </Link>
      </div>

      {/* Analysis · Visualize · MCP: one switch instead of a long scroll; the tab is kept in the address */}
      <div className="sticky top-0 z-10 -mx-4 mt-6 bg-paper/90 px-4 py-3 backdrop-blur-md sm:-mx-8 sm:px-8">
        <Segmented<SettingsTab> label="Settings section" value={tab} onChange={chooseTab} options={SETTINGS_TABS.map((t) => ({ value: t, label: TAB_LABELS[t] }))} />
      </div>

      <AutoHeight className="-mx-2 px-2 pb-2">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.16 }}>
            {tab === 'analysis' && (
              <>
                <section className="mt-8" aria-labelledby="providers-heading">
                  <h2 id="providers-heading" className="display text-[1.75rem] leading-tight">
                    AI providers
                  </h2>
                  <p className="mt-2 max-w-[38rem] text-muted">
                    Each analysis uses the first provider in this list that has a key: the one marked “In use”. Use the arrows to change the order.
                    Keys are read from the <code className="font-mono text-sm">.env</code> file and are never shown here.
                  </p>
                  <div className="mt-4 flex items-center justify-between gap-6 rounded-2xl border border-line bg-surface p-5">
                    <div>
                      <p className="font-medium text-head">Use the next one in line if it fails</p>
                      <p className="mt-0.5 text-[0.9375rem] text-muted">
                        {settings.nextInLine
                          ? 'On: if the provider in use fails or runs out of quota, the next one with a key below it tries, and so on.'
                          : 'Off: if the provider in use fails or runs out of quota, the analysis stops and says why.'}{' '}
                        A retry with its own “Run with” choice only ever uses that one.
                      </p>
                    </div>
                    <Switch label="Use the next one in line if it fails" checked={settings.nextInLine} onChange={(nextInLine) => void save({ nextInLine })} />
                  </div>
                  <ul className="mt-3 space-y-3">
                    {providers.map((provider, index) => (
                      <ProviderCard
                        key={provider.id}
                        provider={provider}
                        inUse={provider.id === inUseId}
                        place={{ n: index + 1, of: providers.length }}
                        onMove={(delta) => move(provider.id, delta)}
                        onUse={() => use(provider.id)}
                        onModels={(models) => void save({ models: { ...settings.models, [provider.id]: models } }, 'Models saved')}
                      />
                    ))}
                  </ul>
                </section>

                <section className="mt-12" aria-labelledby="uploads-heading">
                  <h2 id="uploads-heading" className="display text-[1.75rem] leading-tight">
                    Uploads
                  </h2>
                  <div className="mt-4 flex items-center justify-between gap-6 rounded-2xl border border-line bg-surface p-5">
                    <div>
                      <p className="font-medium text-head">Compress by default</p>
                      <p className="mt-0.5 text-[0.9375rem] text-muted">
                        Start with Compress on when you add two or three images. Four or more are always sent as contact sheets.
                      </p>
                    </div>
                    <Switch
                      label="Compress by default"
                      checked={settings.compressDefault}
                      onChange={(compressDefault) => void save({ compressDefault })}
                    />
                  </div>
                </section>
              </>
            )}
            {tab === 'visualize' && (
              <section className="mt-8" aria-labelledby="imagine-heading">
                <h2 id="imagine-heading" className="display text-[1.75rem] leading-tight">
                  Image generation
                </h2>
                <p className="mt-2 max-w-[38rem] text-[0.9375rem] leading-relaxed text-muted">
                  What Visualize uses. Only this backend and model are tried; if it fails, it says so. Models free Pollen cannot pay for are
                  not listed.
                </p>
                <div className="mt-5 max-w-[30rem]">
                  <ModelSelect value={settings.imagine} onChange={(imagine) => void save({ imagine }, 'Image model saved')} />
                </div>
                <RemovedModels />
              </section>
            )}
            {tab === 'mcp' && <CodingAgents first />}
          </motion.div>
        </AnimatePresence>
      </AutoHeight>

      <section className="mt-16 border-t border-line pt-6" aria-labelledby="storage-heading">
        <h2 id="storage-heading" className="display text-[1.75rem] leading-tight">
          Where things are kept
        </h2>
        <p className="mt-2 max-w-[38rem] text-muted">
          Images and the library database live in the <code className="font-mono text-sm">data</code> folder beside the app,
          on this computer only. Back that folder up to keep your library.
        </p>
      </section>
    </div>
  );
}

/** Under the image model: the models removed for server errors (removed.ts), listed on request. */
function RemovedModels() {
  const { catalog } = useImageCatalog();
  const removed = catalog?.removed ?? [];
  if (!removed.length) return null;
  return (
    <details className="mt-4 max-w-[30rem] text-[0.8125rem] text-muted">
      <summary className="cursor-pointer select-none hover:text-head">
        {removed.length} models removed: they only failed with server errors
      </summary>
      <p className="mt-2 font-mono text-[0.75rem] leading-relaxed">{removed.map((id) => id.replace(/^community\//, '')).join(' · ')}</p>
    </details>
  );
}
