import { composePrompt } from '@/lib/copy/compose';
import type { EntryDetail } from '@/lib/types';
import { api, LIBRARY_CHANGED } from './api';

const cache = new Map<string, string>();

if (typeof window !== 'undefined') {
  // An edit or a retry changes what should be copied.
  window.addEventListener(LIBRARY_CHANGED, () => cache.clear());
}

/** The active version's copy-ready prompt (instruction + JSON), or null if the entry has none yet. */
export function promptOf(entry: EntryDetail): string | null {
  const active = entry.versions.find((v) => v.id === entry.activeVersionId);
  return active ? composePrompt(active.spec) : null;
}

/**
 * A card only knows an entry's summary, so its copy button fetches the prompt. Warming this on
 * hover means the click itself can copy at once, which browsers require for clipboard access.
 */
export async function loadPrompt(entryId: string): Promise<string | null> {
  const known = cache.get(entryId);
  if (known) return known;
  const entry = await api<EntryDetail>(`/api/entries/${entryId}`);
  const prompt = promptOf(entry);
  if (prompt) cache.set(entryId, prompt);
  return prompt;
}

export function cachedPrompt(entryId: string): string | undefined {
  return cache.get(entryId);
}
