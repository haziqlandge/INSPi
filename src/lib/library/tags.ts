const MAX_WORDS = 4;
const MAX_LENGTH = 40;

/** Lowercase, punctuation-free, at most four words. Returns null when nothing usable is left. */
export function normalizeTag(raw: string): string | null {
  const cleaned = raw
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}\s&-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned || !/[\p{L}\p{N}]/u.test(cleaned)) return null;
  return cleaned.split(' ').slice(0, MAX_WORDS).join(' ').slice(0, MAX_LENGTH).trim();
}

export function normalizeTags(raw: unknown, max = 10): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const tag = normalizeTag(item);
    if (tag && !out.includes(tag)) out.push(tag);
    if (out.length >= max) break;
  }
  return out;
}
