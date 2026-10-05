import type { ProviderId } from './ai/client';
import { PROVIDER_IDS, type ModelOverrides } from './ai/registry';
import { AUTO_MODES, type AutoMode } from './imagine/recommend';
import { removedImageModels } from './imagine/removed';
import { isBackendId, type BackendId } from './imagine/types';
import type { Library } from './store/library';

export interface Settings {
  /** Providers in the person's order; the first with a key is the one in use. */
  order: ProviderId[];
  /** When the provider in use fails, try the next one in `order`. Off: a failure is reported as it is. */
  nextInLine: boolean;
  models: Partial<Record<ProviderId, ModelOverrides>>;
  /** Whether the upload tray starts with Compress on for 2–3 images. */
  compressDefault: boolean;
  /**
   * The backend and model Visualize uses. `auto` names an AutoPick mode (strongest, balanced,
   * cheapest) until the person picks a model, which sets it to false (see imagine/recommend.ts).
   */
  imagine: { backend: BackendId; model: string; auto: AutoMode | false };
}

const DEFAULT_IMAGINE: Settings['imagine'] = { backend: 'pollinations', model: 'black-forest-labs/flux.1-schnell', auto: 'strongest' };

/**
 * `stored` is what was saved: a choice saved before AutoPick existed has no `auto`, and an early
 * AutoPick saved `true`; both count as Strongest. A new choice from the browser without `auto` is a pick.
 */
function cleanImagine(value: unknown, fallback: Settings['imagine'], stored = false): Settings['imagine'] {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  if (AUTO_MODES.includes(v.auto as AutoMode)) return { ...DEFAULT_IMAGINE, auto: v.auto as AutoMode };
  if (v.auto === true || (stored && v.auto === undefined)) return DEFAULT_IMAGINE;
  if (typeof v.auto === 'string') return fallback;
  const model = typeof v.model === 'string' ? v.model.trim() : '';
  return isBackendId(v.backend) && /^[^\s]{1,120}$/.test(model) ? { backend: v.backend, model, auto: false } : fallback;
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
  const imagine = cleanImagine(stored.imagine, DEFAULT_IMAGINE, true);
  return {
    order: cleanOrder(stored.order),
    models: cleanModels(stored.models),
    compressDefault: stored.compressDefault === true,
    nextInLine: stored.nextInLine === true,
    // A saved model that has since been removed for server errors reads as AutoPick Strongest
    imagine: !imagine.auto && removedImageModels(lib).has(imagine.model) ? DEFAULT_IMAGINE : imagine,
  };
}

export function writeSettings(lib: Library, patch: unknown): Settings {
  const current = readSettings(lib);
  const p = (patch && typeof patch === 'object' ? patch : {}) as Record<string, unknown>;
  const next: Settings = {
    order: p.order === undefined ? current.order : cleanOrder(p.order),
    models: p.models === undefined ? current.models : cleanModels(p.models),
    compressDefault: typeof p.compressDefault === 'boolean' ? p.compressDefault : current.compressDefault,
    nextInLine: typeof p.nextInLine === 'boolean' ? p.nextInLine : current.nextInLine,
    imagine: p.imagine === undefined ? current.imagine : cleanImagine(p.imagine, current.imagine),
  };
  lib.setSetting(KEY, next);
  return next;
}
