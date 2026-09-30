'use client';

import { AnimatePresence, motion } from 'motion/react';
import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useToast } from '@/components/feedback/toast';
import { ModelPicker, modelChoices, useModelListing } from '@/components/settings/model-picker';
import { ChipIcon } from '@/components/ui/icons';
import type { ProviderId } from '@/lib/ai/client';
import type { ProviderStatus } from '@/lib/ai/status';
import { api } from '@/lib/client/api';
import type { Settings } from '@/lib/settings';

interface Payload {
  settings: Settings;
  providers: ProviderStatus[];
}

/** "openai/gpt-oss-120b" becomes "gpt-oss-120b", for the button's accessible name. */
function shortModel(id: string): string {
  return id.split('/').pop()?.replace(/:free$/, '') ?? id;
}

function Models({ provider, onModels }: { provider: ProviderStatus; onModels: (models: { vision: string; text: string }) => void }) {
  const { listing } = useModelListing(provider.id, provider.hasKey);
  const choices = modelChoices(provider.id, listing);
  return (
    <div className="mt-3 space-y-3">
      <ModelPicker
        label="Model that reads images"
        value={provider.visionModel}
        choices={choices.vision}
        fallback={provider.defaultVision}
        listed={Boolean(listing?.ok)}
        onChange={(vision) => onModels({ vision, text: provider.textModel })}
      />
      <ModelPicker
        label="Model that writes the spec"
        value={provider.textModel}
        choices={choices.text}
        fallback={provider.defaultText || provider.defaultVision}
        listed={Boolean(listing?.ok)}
        onChange={(text) => onModels({ vision: provider.visionModel, text })}
      />
      {listing && !listing.ok && <p className="text-sm text-danger">{listing.message}</p>}
    </div>
  );
}

/**
 * The dock's model button: shows which provider the next analysis will use, and opens a
 * panel to change it or its models. The provider chosen here becomes the one in use.
 */
export function ModelMenu() {
  const toast = useToast();
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Payload>('/api/settings'));
    } catch {
      // the dock stays usable without it
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!open) return;
    void load();
    const onDown = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open, load]);

  async function save(patch: Partial<Settings>, message: string) {
    try {
      setData(await api<Payload>('/api/settings', { method: 'PUT', json: patch }));
      toast.show(message);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'That could not be saved.', { tone: 'error' });
    }
  }

  const providers = data?.providers ?? [];
  const active = providers.find((p) => p.usable) ?? null;

  function choose(id: ProviderId) {
    if (!data || active?.id === id) return;
    const order = [id, ...data.settings.order.filter((other) => other !== id)];
    void save({ order }, `${providers.find((p) => p.id === id)?.label} is now in use`);
  }

  return (
    <div ref={root} className="relative">
      <button
        type="button"
        className="btn h-10 gap-2 px-3"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={active ? `AI model: ${active.label}, ${shortModel(active.visionModel)}. Change` : 'Choose an AI model'}
        onClick={() => setOpen((v) => !v)}
      >
        <ChipIcon size={17} />
        <span className="hidden max-w-[9rem] truncate text-[0.8125rem] md:inline">{active ? active.label : 'No model'}</span>
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            role="dialog"
            aria-label="AI provider and model"
            className="absolute bottom-full right-0 z-[60] mb-3 w-[min(23rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-surface p-4 shadow-lift"
            initial={{ opacity: 0, y: 10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
          >
            <p className="text-sm font-medium text-head">Provider</p>
            {!data ? (
              <p className="mt-2 text-sm text-muted">Loading…</p>
            ) : (
              <>
                <div className="mt-2 grid grid-cols-2 gap-1.5" role="radiogroup" aria-label="Provider in use">
                  {providers.map((p) => {
                    const selected = active?.id === p.id;
                    return (
                      <button
                        key={p.id}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        disabled={!p.hasKey}
                        onClick={() => choose(p.id)}
                        className={`rounded-xl border px-3 py-2 text-left text-[0.875rem] transition-colors disabled:opacity-45 ${
                          selected ? 'border-head bg-head text-paper' : 'border-line hover:border-head/50'
                        }`}
                      >
                        <span className="block truncate font-medium">{p.label.replace(' Workers AI', '')}</span>
                        <span className={`block text-xs ${selected ? 'text-paper/75' : 'text-muted'}`}>
                          {!p.hasKey ? 'No key' : selected ? 'In use' : 'Switch to this'}
                        </span>
                      </button>
                    );
                  })}
                </div>

                {active ? (
                  <Models
                    key={active.id}
                    provider={active}
                    onModels={(models) => void save({ models: { ...data.settings.models, [active.id]: models } }, 'Model saved')}
                  />
                ) : (
                  <p className="mt-3 text-sm text-muted">
                    Add a key to <code className="font-mono">.env</code> to pick a model.
                  </p>
                )}

                <p className="mt-4 text-[0.8125rem] text-muted">
                  If this one fails, the analysis fails; no other provider steps in.{' '}
                  <Link href="/settings" className="text-ink underline decoration-accent underline-offset-4" onClick={() => setOpen(false)}>
                    All settings
                  </Link>
                </p>
              </>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
