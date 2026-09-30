import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openLibrary, type Library } from '@/lib/store/library';
import { buildSpec } from '@/lib/ai/schema/expand';
import type { Category } from '@/lib/library/categories';
import { sampleObservation, sampleWebTranslation } from './fixtures';

let dir: string;
let lib: Library;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'inspi-test-'));
  lib = openLibrary(dir);
});

afterEach(() => {
  lib.close();
  rmSync(dir, { recursive: true, force: true });
});

const image = (n = 1) => ({ id: `img${n}${Math.random().toString(36).slice(2, 8)}`, width: 800, height: 1000, bytes: 1234, placeholder: '#332211', sha256: `sha${n}` });

function analysed(name: string, category: Category, tags: string[], mode: 'web' | 'image' = 'web', collections: string[] = []) {
  const entry = lib.createEntry({ mode, compress: false, images: [image()] });
  const identity = { name, category, tags };
  const spec = buildSpec({ mode: 'web', observation: sampleObservation('web'), translation: sampleWebTranslation(), identity });
  return lib.applyAnalysis(entry.id, {
    identity,
    collections,
    version: { lens: 'balanced', note: `${name} note`, spec, provider: 'Test', model: 'm', tokensIn: 1, tokensOut: 1, durationMs: 1 },
  });
}

describe('entries', () => {
  it('creates a queued, untitled entry with its images in order', () => {
    const entry = lib.createEntry({ mode: 'image', compress: true, images: [image(1), image(2)] });
    expect(entry.status).toBe('queued');
    expect(entry.name).toBe('Untitled');
    expect(entry.slug).toMatch(/^untitled-/);
    expect(entry.mode).toBe('image');
    expect(entry.compress).toBe(true);
    expect(entry.images.map((i) => i.position)).toEqual([0, 1]);
    expect(entry.images[0].full).toBe(`/api/media/${entry.id}/${entry.images[0].id}.webp`);
    expect(entry.images[0].thumb).toBe(`/api/media/${entry.id}/${entry.images[0].id}.thumb.webp`);
    expect(entry.cover?.id).toBe(entry.images[0].id);
    expect(entry.hasPrompt).toBe(false);
  });

  it('names, slugs and tags the entry on its first analysis', () => {
    const entry = analysed('Glass Dusk', 'Landing Page', ['frosted glass', 'dusk']);
    expect(entry.status).toBe('ready');
    expect(entry.name).toBe('Glass Dusk');
    expect(entry.slug).toBe('glass-dusk');
    expect(entry.tags).toEqual(['frosted glass', 'dusk']);
    expect(entry.versions).toHaveLength(1);
    expect(entry.versions[0].n).toBe(1);
    expect(entry.activeVersionId).toBe(entry.versions[0].id);
    expect(entry.hasPrompt).toBe(true);
    expect(lib.getEntry('glass-dusk')?.id).toBe(entry.id);
  });

  it('gives a second entry with the same name its own slug', () => {
    analysed('Glass Dusk', 'Landing Page', []);
    expect(analysed('Glass Dusk', 'Landing Page', []).slug).toBe('glass-dusk-2');
  });

  it('adds a version on retry without renaming, and makes it active', () => {
    const first = analysed('Glass Dusk', 'Landing Page', ['dusk']);
    const spec = first.versions[0].spec;
    const again = lib.applyAnalysis(first.id, {
      identity: { name: 'Other', category: 'Poster & Print', tags: ['other'] },
      version: { lens: 'structure', note: 'second note', spec, provider: 'Test', model: 'm', tokensIn: 1, tokensOut: 1, durationMs: 1 },
    });
    expect(again.name).toBe('Glass Dusk');
    expect(again.category).toBe('Landing Page');
    expect(again.tags).toEqual(['dusk']);
    expect(again.versions.map((v) => v.n)).toEqual([1, 2]);
    expect(again.activeVersionId).toBe(again.versions[1].id);
  });

  it('updates name, category, tags, favourite and active version', () => {
    const entry = analysed('Glass Dusk', 'Landing Page', ['dusk']);
    const updated = lib.updateEntry(entry.id, {
      name: 'Amber Glass',
      category: 'Poster & Print',
      tags: ['Amber', 'amber', 'Soft  Light'],
      favorite: true,
    })!;
    expect(updated.name).toBe('Amber Glass');
    expect(updated.slug).toBe('amber-glass');
    expect(updated.category).toBe('Poster & Print');
    expect(updated.tags).toEqual(['amber', 'soft light']);
    expect(updated.favorite).toBe(true);
    // the copied JSON follows the edit
    expect(updated.versions[0].spec.name).toBe('Amber Glass');
    expect(updated.versions[0].spec.tags).toEqual(['amber', 'soft light']);
  });

  it('rejects an unknown active version', () => {
    const entry = analysed('Glass Dusk', 'Landing Page', []);
    expect(() => lib.updateEntry(entry.id, { activeVersionId: 'nope' })).toThrow();
  });

  it('records progress and failure', () => {
    const entry = lib.createEntry({ mode: 'web', compress: false, images: [image()] });
    lib.setProgress(entry.id, { status: 'analyzing', progress: 'Reading the image', waitUntil: 123 });
    expect(lib.getEntry(entry.id)).toMatchObject({ status: 'analyzing', progress: 'Reading the image', waitUntil: 123 });
    lib.setProgress(entry.id, { status: 'failed', progress: null, waitUntil: null, error: 'No key' });
    expect(lib.getEntry(entry.id)).toMatchObject({ status: 'failed', error: 'No key', progress: null });
  });
});

describe('listing and search', () => {
  beforeEach(() => {
    analysed('Glass Dusk', 'Landing Page', ['frosted glass', 'neon lights']);
    analysed('Ink Wash', 'Illustration', ['traditional asian', 'mountains'], 'image');
    analysed('Neon Kyo', 'Cityscape & Urban', ['neon lights', 'cyber buildings'], 'image');
  });

  it('lists newest first', () => {
    expect(lib.listEntries({}).items.map((e) => e.name)).toEqual(['Neon Kyo', 'Ink Wash', 'Glass Dusk']);
    expect(lib.listEntries({}).total).toBe(3);
  });

  it('filters by category, tag, mode and favourite', () => {
    expect(lib.listEntries({ category: 'Illustration' }).items.map((e) => e.name)).toEqual(['Ink Wash']);
    expect(lib.listEntries({ tag: 'neon lights' }).items.map((e) => e.name)).toEqual(['Neon Kyo', 'Glass Dusk']);
    expect(lib.listEntries({ mode: 'web' }).items.map((e) => e.name)).toEqual(['Glass Dusk']);
    const ink = lib.getEntry('ink-wash')!;
    lib.updateEntry(ink.id, { favorite: true });
    expect(lib.listEntries({ favorite: true }).items.map((e) => e.name)).toEqual(['Ink Wash']);
  });

  it('searches name, category, tags and note; every word must match', () => {
    expect(lib.listEntries({ q: 'mountains' }).items.map((e) => e.name)).toEqual(['Ink Wash']);
    expect(lib.listEntries({ q: 'neon' }).items.map((e) => e.name)).toEqual(['Neon Kyo', 'Glass Dusk']);
    expect(lib.listEntries({ q: 'neon cyber' }).items.map((e) => e.name)).toEqual(['Neon Kyo']);
    expect(lib.listEntries({ q: 'urban' }).items.map((e) => e.name)).toEqual(['Neon Kyo']);
    expect(lib.listEntries({ q: 'glass dusk note' }).items.map((e) => e.name)).toEqual(['Glass Dusk']);
    expect(lib.listEntries({ q: '100%' }).items).toEqual([]);
  });

  it('pages with limit and offset', () => {
    expect(lib.listEntries({ limit: 2 }).items).toHaveLength(2);
    expect(lib.listEntries({ limit: 2, offset: 2 }).items.map((e) => e.name)).toEqual(['Glass Dusk']);
  });

  it('counts tags by use', () => {
    expect(lib.topTags(10)[0]).toEqual({ name: 'neon lights', count: 2 });
  });

  it('finds related entries and leaves the rest for discover', () => {
    const glass = lib.getEntry('glass-dusk')!;
    expect(lib.related(glass.id, 8).map((e) => e.name)).toEqual(['Neon Kyo']);
    const discover = lib.discover({ exclude: [glass.id], limit: 10, offset: 0, seed: 7 });
    expect(discover.map((e) => e.name).sort()).toEqual(['Ink Wash', 'Neon Kyo']);
    const again = lib.discover({ exclude: [glass.id], limit: 10, offset: 0, seed: 7 });
    expect(again.map((e) => e.id)).toEqual(discover.map((e) => e.id));
  });
});

describe('delete and restore', () => {
  it('hides a deleted entry until it is restored', () => {
    const entry = analysed('Glass Dusk', 'Landing Page', ['dusk']);
    lib.softDelete(entry.id);
    expect(lib.getEntry(entry.id)).toBeNull();
    expect(lib.listEntries({}).total).toBe(0);
    expect(lib.topTags(10)).toEqual([]);
    lib.restore(entry.id);
    expect(lib.getEntry(entry.id)?.name).toBe('Glass Dusk');
  });

  it('purges only entries deleted long enough ago', () => {
    const entry = analysed('Glass Dusk', 'Landing Page', []);
    lib.softDelete(entry.id);
    expect(lib.purgeDeleted(60_000)).toEqual([]);
    expect(lib.purgeDeleted(-1)).toEqual([entry.id]);
    lib.restore(entry.id);
    expect(lib.getEntry(entry.id)).toBeNull();
  });
});

describe('collections', () => {
  it('creates, fills, renames and removes collections', () => {
    const a = analysed('Glass Dusk', 'Landing Page', []);
    const b = analysed('Ink Wash', 'Illustration', []);
    const board = lib.createCollection('Client X moodboard');
    expect(board.slug).toBe('client-x-moodboard');

    lib.addToCollection(board.id, a.id);
    lib.addToCollection(board.id, b.id);
    lib.addToCollection(board.id, b.id);
    expect(lib.listCollections()[0]).toMatchObject({ name: 'Client X moodboard', count: 2 });
    expect(lib.listCollections()[0].covers).toHaveLength(2);
    expect(lib.listEntries({ collectionId: board.id }).total).toBe(2);
    expect(lib.getEntry(a.id)!.collectionIds).toEqual([board.id]);

    lib.removeFromCollection(board.id, a.id);
    expect(lib.listEntries({ collectionId: board.id }).items.map((e) => e.name)).toEqual(['Ink Wash']);

    expect(lib.renameCollection(board.id, 'Warm things')!.slug).toBe('warm-things');
    expect(lib.getCollection('warm-things')?.id).toBe(board.id);
    lib.deleteCollection(board.id);
    expect(lib.listCollections()).toEqual([]);
    expect(lib.getEntry(b.id)).not.toBeNull();
  });
});

describe('settings and jobs', () => {
  it('stores settings as JSON with a fallback', () => {
    expect(lib.getSetting('order', ['groq'])).toEqual(['groq']);
    lib.setSetting('order', ['gemini', 'groq']);
    expect(lib.getSetting('order', ['groq'])).toEqual(['gemini', 'groq']);
  });

  it('hands out jobs oldest first and only once', () => {
    const a = lib.createEntry({ mode: 'web', compress: false, images: [image()] });
    const b = lib.createEntry({ mode: 'web', compress: false, images: [image()] });
    lib.enqueueJob(a.id, 'analyze');
    lib.enqueueJob(b.id, 'retry');

    const first = lib.takeJob()!;
    expect(first).toMatchObject({ entryId: a.id, kind: 'analyze' });
    const second = lib.takeJob()!;
    expect(second).toMatchObject({ entryId: b.id, kind: 'retry' });
    expect(lib.takeJob()).toBeNull();

    lib.finishJob(first.id, 'done');
    // a job left running by a crash is handed out again after a reset
    lib.requeueRunningJobs();
    expect(lib.takeJob()).toMatchObject({ id: second.id });
  });

  it('does not queue a second job for an entry that already has one pending', () => {
    const a = lib.createEntry({ mode: 'web', compress: false, images: [image()] });
    expect(lib.enqueueJob(a.id, 'analyze')).toBe(true);
    expect(lib.enqueueJob(a.id, 'retry')).toBe(false);
  });
});

describe('auto collections and tag filters', () => {
  it('files a first analysis into named collections, creating missing ones and reusing existing', () => {
    const mine = lib.createCollection('Client work');
    const a = analysed('One', 'Landing Page', ['x'], 'web', ['Dark & Moody', 'client work']);
    const b = analysed('Two', 'Poster & Print', ['y'], 'web', ['Dark & Moody']);
    expect(a.collections.map((c) => c.name).sort()).toEqual(['Client work', 'Dark & Moody']);
    expect(a.collections.find((c) => c.name === 'Client work')?.id).toBe(mine.id);
    const dark = lib.listCollections().find((c) => c.name === 'Dark & Moody')!;
    expect(dark.count).toBe(2);
    expect(b.collections.map((c) => c.name)).toEqual(['Dark & Moody']);
    expect(lib.collectionNames()).toEqual(expect.arrayContaining(['Client work', 'Dark & Moody']));
  });

  it('narrows to entries that carry every selected tag', () => {
    analysed('A', 'Landing Page', ['flat design', 'hot pink']);
    analysed('B', 'Landing Page', ['flat design', 'teal']);
    analysed('C', 'Landing Page', ['serene']);
    expect(lib.listEntries({ tag: 'flat design' }).items.map((e) => e.name).sort()).toEqual(['A', 'B']);
    expect(lib.listEntries({ tag: 'flat design,hot pink' }).items.map((e) => e.name)).toEqual(['A']);
    expect(lib.listEntries({ tag: 'hot pink,serene' }).total).toBe(0);
    expect(lib.allTags().find((t) => t.name === 'flat design')?.count).toBe(2);
  });
});
