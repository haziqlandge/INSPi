import { slugify } from '../library/slug';
import type { Library } from '../store/library';
import type { EntryDetail } from '../types';
import { str } from './context';

export type Found = { entry: EntryDetail } | { error: string };

/** Name, slug or id; failing those, a search that must point at exactly one entry. */
export function resolveReference(lib: Library, raw: unknown): Found {
  const reference = str(raw);
  if (!reference) return { error: 'Say which reference: its name, slug or id.' };
  const direct = lib.getEntry(reference) ?? lib.getEntry(slugify(reference));
  if (direct) return { entry: direct };

  const { items } = lib.listEntries({ q: reference, limit: 10 });
  const exact = items.filter((item) => item.name.toLowerCase() === reference.toLowerCase());
  const candidates = exact.length ? exact : items;
  if (candidates.length === 1) return { entry: lib.getEntry(candidates[0].id)! };
  if (candidates.length === 0) return { error: `No reference matches "${reference}". Try search_references.` };
  return { error: `"${reference}" matches several references: ${candidates.map((c) => `${c.name} (${c.slug})`).join(', ')}. Pass one of their slugs.` };
}
