import { REMOVED_IMAGE_MODELS } from './removed';
import { healthFrom, type BackendId, type ImageModel, type ModelHealth } from './types';

/** Pollinations' model list is public and free to read; it changes often, so it is cached briefly. */
const CATALOG_URL = 'https://gen.pollinations.ai/image/models?reliability=all';
const CACHE_MS = 10 * 60_000;

interface RawImageModel {
  name?: string;
  title?: string;
  aliases?: string[];
  community?: boolean;
  paid_only?: boolean | null;
  input_modalities?: string[];
  output_modalities?: string[];
  health?: { status?: string; success_rate?: number | null } | null;
}

function toModel(m: RawImageModel): ImageModel {
  const rate = m.health?.success_rate;
  const health = healthFrom(m.health?.status, rate);
  return {
    id: m.name!,
    label: m.title?.trim() || m.aliases?.[0] || m.name!.split('/').pop()!,
    acceptsImage: (m.input_modalities ?? []).includes('image'),
    health,
    successRate: typeof rate === 'number' ? Math.round(rate) : null,
  };
}

/**
 * Keeps the models free Pollen can pay for that answer with an image (no paid-only, no video),
 * split into Pollinations' own and community ones. Healthy models come first.
 */
export function splitImageModels(raw: unknown[]): { official: ImageModel[]; community: ImageModel[] } {
  const official: ImageModel[] = [];
  const community: ImageModel[] = [];
  for (const item of raw as RawImageModel[]) {
    if (!item?.name || item.paid_only === true) continue;
    const outputs = item.output_modalities ?? [];
    if (!outputs.includes('image') || outputs.includes('video')) continue;
    (item.community || item.name.startsWith('community/') ? community : official).push(toModel(item));
  }
  const rank: Record<ModelHealth, number> = { healthy: 0, unknown: 1, degraded: 2 };
  const order = (a: ImageModel, b: ImageModel) => rank[a.health] - rank[b.health] || a.label.localeCompare(b.label);
  return { official: official.sort(order), community: community.sort(order) };
}

const KEYLESS: ImageModel[] = [{ id: 'default', label: 'Default', acceptsImage: false, health: 'unknown', successRate: null }];

const cache = globalThis as { __inspiImageCatalog?: { at: number; split: ReturnType<typeof splitImageModels> } };

/**
 * The models a backend offers, less the removed ones (removed.ts). The keyless route has no
 * list, so it offers its default.
 */
export async function imageModels(backend: BackendId, fetchImpl: typeof fetch = fetch, removed: ReadonlySet<string> = REMOVED_IMAGE_MODELS): Promise<ImageModel[]> {
  if (backend === 'keyless-url') return KEYLESS;
  const hit = cache.__inspiImageCatalog;
  let split = hit && Date.now() - hit.at < CACHE_MS ? hit.split : null;
  if (!split) {
    const response = await fetchImpl(CATALOG_URL, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) throw new Error(`Pollinations' model list answered ${response.status}.`);
    const payload = (await response.json()) as unknown;
    const list = Array.isArray(payload) ? payload : ((payload as { data?: unknown[] })?.data ?? []);
    split = splitImageModels(list);
    cache.__inspiImageCatalog = { at: Date.now(), split };
  }
  return (backend === 'pollinations' ? split.official : split.community).filter((m) => !removed.has(m.id));
}
