import { ok } from '@/lib/http';
import { BACKEND_LABELS, backendAvailable } from '@/lib/imagine/backends';
import { imageModels } from '@/lib/imagine/catalog';
import { AUTO_MODES, recommendModel, type AutoMode } from '@/lib/imagine/recommend';
import { removedImageModels } from '@/lib/imagine/removed';
import { library } from '@/lib/store';
import { BACKEND_IDS, type BackendId, type ImageModel } from '@/lib/imagine/types';

export interface BackendListing {
  id: BackendId;
  label: string;
  available: boolean;
  experimental: boolean;
  models: ImageModel[];
  message: string;
}

export interface ImageCatalog {
  backends: BackendListing[];
  /** What each AutoPick mode would use right now (healthy, and not failed here in the last day). */
  recommended: Record<AutoMode, string | null>;
  /** Models removed for server errors (removed.ts), for Settings to name. */
  removed: string[];
}

const DAY_MS = 86_400_000;

/** Each backend with its models. Reading Pollinations' list is free and spends no Pollen. */
export async function GET() {
  // Models removed for server errors (verified, plus any that only fail since) are never listed
  const removed = removedImageModels(library());
  const backends: BackendListing[] = await Promise.all(
    BACKEND_IDS.map(async (id) => {
      const available = backendAvailable(id);
      const base = { id, label: BACKEND_LABELS[id], available, experimental: id === 'keyless-url' };
      if (!available) return { ...base, models: [], message: 'Add POLLINATIONS_API_KEY to .env and restart the server.' };
      try {
        const models = await imageModels(id, fetch, removed);
        const message =
          id === 'keyless-url'
            ? 'No key, no model choice. Unverified: it may be slow, watermarked or switched off.'
            : `${models.length} models free Pollen can pay for.`;
        return { ...base, models, message };
      } catch (error) {
        return { ...base, models: [], message: error instanceof Error ? error.message : 'The model list could not be read.' };
      }
    }),
  );
  const official = backends.find((b) => b.id === 'pollinations')?.models ?? [];
  const failing = new Set(library().failingImageModels(Date.now() - DAY_MS));
  const recommended = Object.fromEntries(AUTO_MODES.map((mode) => [mode, recommendModel(official, failing, mode)])) as Record<AutoMode, string | null>;
  return ok({ backends, recommended, removed: [...removed].sort() } satisfies ImageCatalog);
}
