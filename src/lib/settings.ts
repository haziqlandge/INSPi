import type { ProviderId } from './ai/client';
import { PROVIDER_IDS, type ModelOverrides } from './ai/registry';
import type { Library } from './store/library';

export interface Settings {
  /** Providers are tried in this order; ones without a key are skipped. */
  order: ProviderId[];
  models: Partial<Record<ProviderId, ModelOverrides>>;
  /** Whether the upload tray starts with Compress on for 2–3 images. */
  compressDefault: boolean;
}

const KEY = 'settings';

function cleanOrder(value: unknown): ProviderId[] {
  const given = Array.isArray(value) ? value.filter((id): id is ProviderId => PROVIDER_IDS.includes(id)) : [];
  const unique = [...new Set(given)];
  return [...unique, ...PROVIDER_IDS.filter((id) => !unique.includes(id))];
}

function cleanModels(value: unknown): Settings['models'] {
  const out: Settings['models'] = {};
  if (!value || typeof value !== 'object') return out;
  for (const id of PROVIDER_IDS) {
    const entry = (value as Record<string, unknown>)[id];
    if (!entry || typeof entry !== 'object') continue;
    const { vision, text } = entry as Record<string, unknown>;
    const cleaned: ModelOverrides = {};
    if (typeof vision === 'string' && vision.trim()) cleaned.vision = vision.trim().slice(0, 120);
    if (typeof text === 'string' && text.trim()) cleaned.text = text.trim().slice(0, 120);
    if (cleaned.vision || cleaned.text) out[id] = cleaned;
  }
  return out;
}

export function readSettings(lib: Library): Settings {
  const stored = lib.getSetting<Partial<Settings>>(KEY, {});
  return {
    order: cleanOrder(stored.order),
    models: cleanModels(stored.models),
    compressDefault: stored.compressDefault === true,
  };
}

export function writeSettings(lib: Library, patch: unknown): Settings {
  const current = readSettings(lib);
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
  const next: Settings = {
    order: p.order === undefined ? current.order : cleanOrder(p.order),
    models: p.models === undefined ? current.models : cleanModels(p.models),
    compressDefault: typeof p.compressDefault === 'boolean' ? p.compressDefault : current.compressDefault,
  };
  lib.setSetting(KEY, next);
  return next;
}
