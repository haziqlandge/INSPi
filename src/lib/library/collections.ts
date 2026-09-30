/**
 * Collections the AI files entries into. They describe the look or mood (categories already say
 * what kind of thing it is). Each line's `about` helps the model choose. Any collection the user
 * makes later joins this list when the model is asked to choose.
 */
export interface CollectionChoice {
  name: string;
  about?: string;
}

export const SEED_COLLECTIONS: CollectionChoice[] = [
  { name: 'Dark & Moody', about: 'low-key, shadowy, deep blacks, atmospheric' },
  { name: 'Light & Airy', about: 'bright, open, soft light, lots of white' },
  { name: 'Neon & Cyber', about: 'glowing neon on dark, cyberpunk, night city' },
  { name: 'Retro Futurism', about: 'chrome, space age, synthwave, 80s sci-fi' },
  { name: 'Vintage & Nostalgic', about: 'aged, faded, old print or film feel' },
  { name: 'Neo-Brutalist', about: 'thick black borders, hard shadows, raw flat colour' },
  { name: 'Swiss & Grid', about: 'strict grid, sans serif, ordered, International Style' },
  { name: 'Editorial Serif', about: 'magazine feel, expressive serif headlines, print layout' },
  { name: 'Minimal & Quiet', about: 'sparse, restrained, few elements, lots of space' },
  { name: 'Maximalist & Loud', about: 'dense, clashing, packed with pattern and colour' },
  { name: 'Glass & Blur', about: 'frosted translucent layers, backdrop blur' },
  { name: 'Soft Pastel', about: 'gentle low-saturation colour, sweet and calm' },
  { name: 'Bold Colour Blocks', about: 'big flat fields of saturated colour' },
  { name: 'Flat & Playful', about: 'flat vector shapes, friendly, quirky illustration' },
  { name: '3D & Glossy', about: 'rendered objects, shine, depth, clay or plastic' },
  { name: 'Hand-Drawn & Organic', about: 'sketchy lines, imperfect, natural textures' },
  { name: 'Earthy & Natural', about: 'browns, greens, organic materials, outdoors' },
  { name: 'Luxury & Refined', about: 'elegant, gold or black, high-end, restrained' },
  { name: 'Grainy & Filmic', about: 'film grain, cinematic colour grading, analog' },
  { name: 'Gradient Glow', about: 'smooth colour gradients, aurora, light blooms' },
  { name: 'Monochrome', about: 'one colour or black and white throughout' },
  { name: 'Geometric & Abstract', about: 'shapes, patterns, non-figurative composition' },
  { name: 'Heritage & Traditional', about: 'historic or cultural art and craft traditions' },
  { name: 'Techy & Terminal', about: 'monospace, dashboards, code, developer tools' },
  { name: 'Cinematic', about: 'wide, dramatic lighting, movie still feeling' },
  { name: 'Y2K & Chrome', about: 'early 2000s web, bubbly, metallic, iridescent' },
  { name: 'Paper & Print', about: 'risograph, halftone, collage, tactile print textures' },
  { name: 'Dreamy & Surreal', about: 'unreal, floating, fantasy, soft and strange' },
  { name: 'Corporate & Clean', about: 'trustworthy product and business design' },
];

/** The seed list followed by the user's own collections, without repeats (case-insensitive). */
export function collectionChoices(userNames: string[]): CollectionChoice[] {
  const seen = new Set(SEED_COLLECTIONS.map((c) => c.name.toLowerCase()));
  const extra = userNames.filter((name) => {
    const key = name.trim().toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return [...SEED_COLLECTIONS, ...extra.map((name) => ({ name }))];
}

/** Maps what the model wrote onto the offered names (case-insensitive), dropping anything else. */
export function pickCollections(raw: unknown, offered: string[], max = 3): string[] {
  if (!Array.isArray(raw)) return [];
  const byKey = new Map(offered.map((name) => [name.toLowerCase(), name]));
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const name = byKey.get(item.trim().toLowerCase());
    if (name && !out.includes(name)) out.push(name);
    if (out.length >= max) break;
  }
  return out;
}
