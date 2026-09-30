/** The 30 hard-coded categories. A category says what kind of thing an entry is; tags carry the specifics. */
export const CATEGORIES = [
  'Landing Page',
  'Dashboard & Data',
  'Mobile App',
  'E-commerce & Product Page',
  'Portfolio & Personal',
  'Editorial & Magazine',
  'Component & UI Kit',
  'Game & HUD Interface',
  'Branding & Identity',
  'Logo & Mark',
  'Typography & Lettering',
  'Poster & Print',
  'Packaging',
  'Album & Cover Art',
  'Illustration',
  'Icon & Pictogram',
  '3D & Render',
  'Motion & Film Still',
  'Photography',
  'Portrait & Character',
  'Fashion & Beauty',
  'Product & Still Life',
  'Food & Drink',
  'Architecture & Interior',
  'Cityscape & Urban',
  'Landscape & Nature',
  'Sci-Fi & Cyber',
  'Fantasy & Surreal',
  'Anime & Comic',
  'Abstract, Pattern & Texture',
] as const;

export type Category = (typeof CATEGORIES)[number];

export const FALLBACK_CATEGORY: Category = 'Abstract, Pattern & Texture';

const byLower = new Map(CATEGORIES.map((c) => [c.toLowerCase(), c]));

/** Models occasionally return a near-miss; anything that is not one of the 30 becomes the fallback. */
export function coerceCategory(value: unknown): Category {
  if (typeof value !== 'string') return FALLBACK_CATEGORY;
  return byLower.get(value.trim().toLowerCase()) ?? FALLBACK_CATEGORY;
}

export function isCategory(value: unknown): value is Category {
  return typeof value === 'string' && byLower.get(value.toLowerCase()) === value;
}
