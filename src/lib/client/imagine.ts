import type { BackendListing, ImageCatalog } from '@/app/api/imagine/models/route';
import type { AutoMode } from '@/lib/imagine/recommend';
import type { BackendId } from '@/lib/imagine/types';
import type { Render } from '@/lib/types';
import { api } from './api';
import { IMAGE_BACKENDS_KEY, readCache, writeCache } from './model-cache';

export type { BackendListing, ImageCatalog };

export interface VisualizeBody {
  backend: BackendId;
  model: string;
  prompt: string;
  negative?: string;
  aspect?: string;
  entryId?: string;
  versionId?: string;
  /** Show the model the entry's first picture (models that take an image only). */
  reference?: boolean;
}

/** Fired after a render is made or deleted, so every strip and wall can refetch. */
export const RENDERS_CHANGED = 'inspi:renders-changed';

export async function visualize(body: VisualizeBody): Promise<Render> {
  const render = await api<Render>('/api/imagine', { method: 'POST', json: body });
  window.dispatchEvent(new Event(RENDERS_CHANGED));
  return render;
}

export async function listRenders(params: { entryId?: string; backend?: BackendId; offset?: number } = {}): Promise<Render[]> {
  const query = new URLSearchParams();
  if (params.entryId) query.set('entryId', params.entryId);
  if (params.backend) query.set('backend', params.backend);
  if (params.offset) query.set('offset', String(params.offset));
  return (await api<{ items: Render[] }>(`/api/imagine?${query}`)).items;
}

export async function deleteRender(id: string): Promise<void> {
  await api(`/api/imagine/${id}`, { method: 'DELETE' });
  window.dispatchEvent(new Event(RENDERS_CHANGED));
}

export async function imageCatalog(): Promise<ImageCatalog> {
  const catalog = await api<ImageCatalog>('/api/imagine/models');
  if (catalog.backends.some((b) => b.models.length)) writeCache(IMAGE_BACKENDS_KEY, catalog);
  return catalog;
}

/** The image catalogue kept in the browser, if any, and whether it is recent. */
export function cachedImageCatalog(): { value: ImageCatalog; fresh: boolean } | null {
  const cached = readCache<ImageCatalog>(IMAGE_BACKENDS_KEY);
  // Older copies (a bare list, one recommendation instead of one per mode, no list of removed models) count as missing.
  return cached && Array.isArray(cached.value?.backends) && typeof cached.value.recommended === 'object' && cached.value.recommended && Array.isArray(cached.value.removed) ? cached : null;
}

/** What Visualize actually uses: the person's pick, or what their AutoPick mode recommends now. */
export function effectiveChoice(choice: { backend: BackendId; model: string; auto: AutoMode | false }, recommended: ImageCatalog['recommended'] | null) {
  const auto = choice.auto ? recommended?.[choice.auto] : null;
  return auto ? { backend: 'pollinations' as const, model: auto } : { backend: choice.backend, model: choice.model };
}
