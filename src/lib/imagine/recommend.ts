import type { ImageModel } from './types';

/** How Visualize picks a model while on AutoPick. */
export type AutoMode = 'strongest' | 'balanced' | 'cheapest';
export const AUTO_MODES: AutoMode[] = ['strongest', 'balanced', 'cheapest'];

interface ModelFacts {
  /** Artificial Analysis text-to-image Elo from blind human votes, 3 Oct 2026; null when not ranked. */
  elo: number | null;
  /**
   * Pollen for one 1024² image with a full INSPi prompt (about 2,300 text tokens). Flat-priced
   * models: Pollinations' price. Token-priced ones (GPT Image, MAI): Pollinations' token prices times
   * the usual ~1,056 image tokens of a medium-quality square, so approximate.
   */
  pollen: number;
  /** Seconds one image took on this project's key, 3 Oct 2026. */
  seconds: number;
}

export const MODEL_FACTS: Record<string, ModelFacts> = {
  'openai/gpt-image-2': { elo: 1172, pollen: 0.032, seconds: 52 },
  'openai/gpt-image-1.5': { elo: 1107, pollen: 0.034, seconds: 26 },
  'tongyi-mai/z-image-turbo': { elo: 941, pollen: 0.004, seconds: 11 },
  'openai/gpt-image-1-mini': { elo: 917, pollen: 0.01, seconds: 28 },
  'black-forest-labs/flux.1-kontext-pro': { elo: 909, pollen: 0.03, seconds: 15 },
  'black-forest-labs/flux.1.1-pro': { elo: 891, pollen: 0.03, seconds: 14 },
  'black-forest-labs/flux.2-klein-4b': { elo: 863, pollen: 0.005, seconds: 11 },
  'black-forest-labs/flux.1-schnell': { elo: 803, pollen: 0.002, seconds: 13 },
  'lykon/dreamshaper-8-lcm': { elo: null, pollen: 0.0001, seconds: 9 },
};

/**
 * Free-Pollen models from strongest to weakest. Each produced an image on this key on 3 Oct 2026;
 * MAI Image 2.6 and 2.6 Flash did too, but only failed with server errors afterwards and were
 * removed on 5 Oct (removed.ts).
 */
export const STRONGEST_FIRST = Object.entries(MODEL_FACTS)
  .sort(([, a], [, b]) => (b.elo ?? 0) - (a.elo ?? 0))
  .map(([id]) => id);

const rank = (id: string) => {
  const i = STRONGEST_FIRST.indexOf(id);
  return i < 0 ? STRONGEST_FIRST.length : i;
};

/**
 * Quality for what it costs: rating above FLUX Schnell's floor (800) over the fourth roots of Pollen
 * and seconds, so a model must be clearly better to be worth twice the price or wait.
 */
function value(facts: ModelFacts): number {
  return ((facts.elo ?? 800) - 800) / (facts.pollen ** 0.25 * facts.seconds ** 0.25);
}

/** Worked for at least this share of Pollinations' recent requests. */
const RELIABLE = 95;

/**
 * The model AutoPick uses, among those Pollinations reports healthy and reliable and that have not
 * just failed for this person (out of Pollen, refused…):
 * - strongest: the highest rating;
 * - balanced: the best rating for the Pollen and time it costs (see `value`);
 * - cheapest: the lowest price among models with a measured rating.
 */
export function recommendModel(models: ImageModel[], failing: Set<string>, mode: AutoMode = 'strongest'): string | null {
  const byStrength = [...models].sort((a, b) => rank(a.id) - rank(b.id));
  const healthy = byStrength.filter((m) => m.health === 'healthy' && !failing.has(m.id));
  const reliable = healthy.filter((m) => m.successRate === null || m.successRate >= RELIABLE);
  const pool = reliable.length ? reliable : healthy;
  const known = pool.filter((m) => MODEL_FACTS[m.id]?.elo != null);
  if (mode === 'balanced' && known.length) {
    return [...known].sort((a, b) => value(MODEL_FACTS[b.id]) - value(MODEL_FACTS[a.id]))[0].id;
  }
  if (mode === 'cheapest' && known.length) {
    return [...known].sort((a, b) => MODEL_FACTS[a.id].pollen - MODEL_FACTS[b.id].pollen)[0].id;
  }
  return pool[0]?.id ?? byStrength[0]?.id ?? null;
}
