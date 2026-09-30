import { describe, expect, it } from 'vitest';
import { CATEGORIES, coerceCategory, FALLBACK_CATEGORY } from '@/lib/library/categories';
import { normalizeTag, normalizeTags } from '@/lib/library/tags';
import { slugify, uniqueSlug } from '@/lib/library/slug';
import { rankRelated, relatedScore } from '@/lib/library/related';
import { collectionChoices, pickCollections, SEED_COLLECTIONS } from '@/lib/library/collections';
import { groupOfTag, snapTags, VOCABULARY } from '@/lib/library/vocabulary';

describe('categories', () => {
  it('has exactly 30 unique categories', () => {
    expect(CATEGORIES).toHaveLength(30);
    expect(new Set(CATEGORIES).size).toBe(30);
  });

  it('coerces by exact and case-insensitive match', () => {
    expect(coerceCategory('Landing Page')).toBe('Landing Page');
    expect(coerceCategory('  landing page ')).toBe('Landing Page');
  });

  it('falls back for unknown or non-string values', () => {
    expect(coerceCategory('Spaceships')).toBe(FALLBACK_CATEGORY);
    expect(coerceCategory(undefined)).toBe(FALLBACK_CATEGORY);
  });
});

describe('tags', () => {
  it('lowercases, trims, strips a leading hash and collapses spaces', () => {
    expect(normalizeTag('  #Neon   Lights ')).toBe('neon lights');
  });

  it('drops punctuation but keeps hyphens and ampersands', () => {
    expect(normalizeTag('Art-Deco!')).toBe('art-deco');
    expect(normalizeTag('black & white')).toBe('black & white');
  });

  it('returns null for empty results', () => {
    expect(normalizeTag('   ')).toBeNull();
    expect(normalizeTag('!!!')).toBeNull();
  });

  it('caps a tag at four words and 40 characters', () => {
    expect(normalizeTag('one two three four five six')).toBe('one two three four');
    expect(normalizeTag('a'.repeat(60))!.length).toBe(40);
  });

  it('dedupes, keeps order, ignores non-strings, and caps the list', () => {
    expect(normalizeTags(['Glass', 'glass', 7, 'Dusk  Gradient', ''])).toEqual(['glass', 'dusk gradient']);
    const many = Array.from({ length: 20 }, (_, i) => `tag ${i}`);
    expect(normalizeTags(many)).toHaveLength(10);
    expect(normalizeTags(many, 3)).toHaveLength(3);
  });

  it('returns an empty list for non-arrays', () => {
    expect(normalizeTags('glass')).toEqual([]);
  });
});

describe('slug', () => {
  it('makes url-safe slugs', () => {
    expect(slugify('Glass Dusk')).toBe('glass-dusk');
    expect(slugify('  Néon / Kyō!! ')).toBe('neon-kyo');
  });

  it('falls back when nothing usable is left', () => {
    expect(slugify('***')).toBe('untitled');
  });

  it('appends a counter until the slug is free', () => {
    const taken = new Set(['glass-dusk', 'glass-dusk-2']);
    expect(uniqueSlug('glass-dusk', (s) => taken.has(s))).toBe('glass-dusk-3');
    expect(uniqueSlug('paper-grid', (s) => taken.has(s))).toBe('paper-grid');
  });
});

describe('related', () => {
  const base = { id: 'a', category: 'Landing Page', mode: 'web' as const, tags: ['glass', 'dusk', 'neon'] };

  it('scores category, shared tags and mode', () => {
    expect(relatedScore(base, { id: 'b', category: 'Landing Page', mode: 'web', tags: ['glass', 'neon'] })).toBe(3 + 4 + 1);
    expect(relatedScore(base, { id: 'c', category: 'Poster & Print', mode: 'image', tags: [] })).toBe(0);
  });

  it('ranks by score, drops the entry itself and anything unrelated', () => {
    const ranked = rankRelated(
      base,
      [
        base,
        { id: 'weak', category: 'Poster & Print', mode: 'web', tags: [] },
        { id: 'tag', category: 'Poster & Print', mode: 'image', tags: ['glass'] },
        { id: 'strong', category: 'Landing Page', mode: 'web', tags: ['glass', 'dusk'] },
      ],
      8,
    );
    expect(ranked.map((e) => e.id)).toEqual(['strong', 'tag']);
  });

  it('respects the limit', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({ id: `e${i}`, category: 'Landing Page', mode: 'web' as const, tags: [] }));
    expect(rankRelated(base, many, 5)).toHaveLength(5);
  });
});

describe('vocabulary', () => {
  it('keeps premade tags, snaps near misses, and limits brand-new tags', () => {
    const snapped = snapTags(['Neon Light', 'flat-design', 'glassmorphism', 'zany tag one', 'zany tag two', 'zany tag three'], {
      maxNew: 2,
    });
    expect(snapped).toEqual(['neon lights', 'flat design', 'glassmorphism', 'zany tag one', 'zany tag two']);
  });

  it('does not count a tag already used in the library as new', () => {
    expect(snapTags(['my tag', 'other one', 'third'], { known: ['my tag'], maxNew: 1 })).toEqual(['my tag', 'other one']);
  });

  it('groups tags and puts unknown ones under Other', () => {
    expect(groupOfTag('hot pink')).toBe('Colour');
    expect(groupOfTag('serene')).toBe('Mood');
    expect(groupOfTag('something else')).toBe('Other');
    expect(VOCABULARY.length).toBeGreaterThan(200);
    expect(new Set(VOCABULARY).size).toBe(VOCABULARY.length);
    for (const tag of VOCABULARY) expect(normalizeTag(tag), tag).toBe(tag);
  });
});

describe('collection choices', () => {
  it('offers the seed list first, then the user own collections without repeats', () => {
    const offered = collectionChoices(['Client work', 'dark & moody', 'Client work']);
    expect(offered.slice(0, SEED_COLLECTIONS.length)).toEqual(SEED_COLLECTIONS);
    expect(offered.slice(SEED_COLLECTIONS.length)).toEqual([{ name: 'Client work' }]);
    expect(SEED_COLLECTIONS.length).toBeGreaterThanOrEqual(20);
    expect(SEED_COLLECTIONS.length).toBeLessThanOrEqual(30);
  });

  it('maps the model answer onto offered names and drops the rest', () => {
    const offered = ['Dark & Moody', 'Glass & Blur', 'Monochrome', 'Cinematic'];
    expect(pickCollections(['glass & blur', 'Made Up', 'Dark & Moody', 'Monochrome', 'Cinematic'], offered)).toEqual([
      'Glass & Blur',
      'Dark & Moody',
      'Monochrome',
    ]);
    expect(pickCollections('nope', offered)).toEqual([]);
  });
});
