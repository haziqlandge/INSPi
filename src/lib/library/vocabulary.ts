import { normalizeTag } from './tags';

/**
 * The premade tags the AI must choose from. Fixed wording keeps the library searchable: one
 * "flat design", never "flat vector" and "flat style" as well. The groups are also how the tag
 * browser lays tags out. Words are lowercase, at most three to a tag.
 */
export const TAG_GROUPS: { group: string; tags: string[] }[] = [
  {
    group: 'Style',
    tags: [
      'flat design', 'minimalist', 'maximalist', 'brutalist', 'neo-brutalist', 'swiss style', 'bauhaus', 'art deco',
      'art nouveau', 'memphis', 'y2k', 'retro futurism', 'vaporwave', 'synthwave', 'cyberpunk', 'glassmorphism',
      'neumorphism', 'claymorphism', 'skeuomorphic', 'isometric', 'low poly', 'pixel art', 'vector illustration',
      'line art', 'woodcut', 'ukiyo-e', 'risograph', 'halftone', 'collage', 'paper cut', 'hand drawn', 'watercolor',
      'oil painting', 'gouache', 'ink wash', 'sketch', 'engraving', 'blueprint', 'editorial', 'corporate', 'geometric',
      'organic shapes', 'typographic', 'grid layout', 'asymmetric layout', 'bento grid', 'card layout', 'split screen',
      'full bleed', 'parallax', 'dark mode', 'light mode', 'gradient mesh', 'aurora gradient', 'film grain',
      'duotone', 'monochrome', 'high contrast', 'outlined', 'bold outlines', 'thick borders', 'hard shadows',
      'soft shadows', 'rounded corners', 'sharp corners', 'pill buttons', 'serif headline', 'sans serif', 'monospace',
      'glossy', 'matte', 'textured', 'pattern',
    ],
  },
  {
    group: 'Subject',
    tags: [
      'landscape', 'mountains', 'ocean', 'waves', 'forest', 'desert', 'sky', 'clouds', 'sunset', 'night sky',
      'city skyline', 'skyscrapers', 'architecture', 'interior', 'furniture', 'street', 'car', 'motorcycle', 'portrait',
      'figure', 'character', 'animal', 'flowers', 'plants', 'food', 'drink', 'fashion', 'jewelry', 'product',
      'packaging', 'logo', 'icon', 'typography', 'lettering', 'poster', 'book cover', 'album cover', 'map', 'chart',
      'dashboard', 'mobile app', 'landing page', 'e-commerce', 'pricing', 'hero section', 'navigation', 'footer',
      'card', 'form', 'button', 'illustration', 'mascot', 'coins', 'money', 'shapes', 'abstract', 'space', 'planets',
      'robot', 'technology', 'workspace', 'music', 'sports', 'gaming', 'nature', 'water', 'fire', 'neon lights',
      'rain', 'snow', 'fog', 'bridge', 'window', 'door', 'still life', 'crowd', 'hands', 'face', 'eyes', 'text only',
    ],
  },
  {
    group: 'Colour',
    tags: [
      'black and white', 'hot pink', 'pink', 'red', 'orange', 'yellow', 'green', 'teal', 'blue', 'navy', 'purple',
      'violet', 'brown', 'beige', 'cream', 'gold', 'silver', 'neon green', 'pastel', 'earth tones', 'warm palette',
      'cool palette', 'muted palette', 'vibrant palette', 'jewel tones', 'off white', 'charcoal', 'teal and orange',
      'blue and orange', 'red and black', 'black and gold', 'rainbow',
    ],
  },
  {
    group: 'Mood',
    tags: [
      'calm', 'serene', 'moody', 'dramatic', 'playful', 'energetic', 'bold', 'elegant', 'luxurious', 'cozy',
      'nostalgic', 'futuristic', 'mysterious', 'dreamy', 'romantic', 'gritty', 'clean', 'friendly', 'technical',
      'edgy', 'whimsical', 'cinematic', 'melancholic', 'optimistic', 'serious', 'quirky', 'warm', 'cold', 'eerie',
    ],
  },
  {
    group: 'Era & culture',
    tags: [
      '1920s', '1950s', '1960s', '1970s', '1980s', '1990s', '2000s', 'victorian', 'mid century modern', 'japanese',
      'traditional asian', 'nordic', 'mediterranean', 'african', 'latin american', 'middle eastern', 'gothic',
      'baroque', 'renaissance', 'modernist', 'postmodern', 'contemporary', 'vintage', 'retro', 'futuristic era',
    ],
  },
  {
    group: 'Technique',
    tags: [
      'photography', '35mm film', 'long exposure', 'macro', 'aerial view', 'low angle', 'wide angle',
      'shallow depth of field', 'studio lighting', 'natural light', 'golden hour', 'backlit', 'silhouette',
      '3d render', 'digital painting', 'screenshot', 'mockup', 'ui design', 'motion blur', 'symmetry',
      'centered composition', 'negative space', 'dense layout', 'tilt shift', 'double exposure', 'print',
      'wet asphalt', 'reflections', 'lens flare',
    ],
  },
];

const GROUP_OF = new Map<string, string>();
for (const { group, tags } of TAG_GROUPS) for (const tag of tags) GROUP_OF.set(tag, group);

export const VOCABULARY: string[] = [...GROUP_OF.keys()];
export const OTHER_GROUP = 'Other';

export function groupOfTag(tag: string): string {
  return GROUP_OF.get(tag) ?? OTHER_GROUP;
}

/** The vocabulary as one compact line per group, for the prompt. */
export function vocabularyBlock(): string {
  return TAG_GROUPS.map(({ group, tags }) => `${group}: ${tags.join(', ')}`).join('\n');
}

/** "neon light" → "neon lights", "art-deco" → "art deco", "flat-design" → "flat design". */
function vocabularyMatch(tag: string): string | null {
  if (GROUP_OF.has(tag)) return tag;
  const spaced = tag.replace(/-/g, ' ');
  const hyphened = tag.replace(/ /g, '-');
  const candidates = [spaced, hyphened, `${tag}s`, tag.replace(/s$/, ''), `${spaced}s`, spaced.replace(/s$/, ''), tag.replace(/ and /g, ' & ')];
  return candidates.find((c) => GROUP_OF.has(c)) ?? null;
}

export interface SnapOptions {
  /** Tags already in the library outside the vocabulary: reusing one is not "new". */
  known?: string[];
  /** Tags outside both lists that may still be kept, for things the vocabulary genuinely lacks. */
  maxNew?: number;
  max?: number;
}

/**
 * Pulls what the model wrote onto the vocabulary. Near misses ("neon light") become the premade
 * tag; tags already used in the library are kept; only a few genuinely new tags survive.
 */
export function snapTags(raw: unknown, { known = [], maxNew = 2, max = 10 }: SnapOptions = {}): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  let fresh = 0;
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const tag = normalizeTag(item);
    if (!tag) continue;
    const matched = vocabularyMatch(tag);
    const final = matched ?? tag;
    if (out.includes(final)) continue;
    if (!matched && !known.includes(tag)) {
      if (fresh >= maxNew) continue;
      fresh++;
    }
    out.push(final);
    if (out.length >= max) break;
  }
  return out;
}
