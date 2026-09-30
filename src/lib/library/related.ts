import type { Mode } from '../types';

export interface Relatable {
  id: string;
  category: string;
  mode: Mode;
  tags: string[];
}

const SAME_CATEGORY = 3;
const SHARED_TAG = 2;
const SAME_MODE = 1;

/** Mode alone is not a relation: two entries need a shared category or tag to score at all. */
export function relatedScore(a: Relatable, b: Relatable): number {
  const shared = b.tags.filter((tag) => a.tags.includes(tag)).length;
  const sameCategory = a.category === b.category;
  if (!sameCategory && shared === 0) return 0;
  return (sameCategory ? SAME_CATEGORY : 0) + shared * SHARED_TAG + (a.mode === b.mode ? SAME_MODE : 0);
}

export function rankRelated<T extends Relatable>(target: Relatable, candidates: T[], limit: number): T[] {
  return candidates
    .filter((c) => c.id !== target.id)
    .map((c) => ({ c, score: relatedScore(target, c) }))
    .filter((x) => x.score > 0)
    .sort((x, y) => y.score - x.score)
    .slice(0, limit)
    .map((x) => x.c);
}
