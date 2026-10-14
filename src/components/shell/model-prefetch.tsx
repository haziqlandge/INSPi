'use client';

import { useEffect } from 'react';
import { fetchModelListing } from '@/components/settings/model-picker';
import type { ProviderStatus } from '@/lib/ai/status';
import { api } from '@/lib/client/api';
import { cachedImageCatalog, imageCatalog } from '@/lib/client/imagine';
import { modelsKey, readCache } from '@/lib/client/model-cache';

/**
 * Fetches every model list once when the site opens (and only if the kept copy is a few hours old),
 * so dropdowns anywhere draw complete straight away. Draws nothing.
 */
export function ModelPrefetch() {
  useEffect(() => {
    const timer = window.setTimeout(async () => {
      try {
        const { providers } = await api<{ providers: ProviderStatus[] }>('/api/settings');
        for (const p of providers) {
          if (p.hasKey && !readCache(modelsKey(p.id))?.fresh) await fetchModelListing(p.id).catch(() => {});
        }
        if (!cachedImageCatalog()?.fresh) await imageCatalog().catch(() => {});
      } catch {
        // offline or server restarting: pickers fetch for themselves
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, []);
  return null;
}
