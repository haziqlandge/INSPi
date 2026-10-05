import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openLibrary, type Library } from '@/lib/store/library';

let dir: string;
let lib: Library;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'inspi-renders-'));
  lib = openLibrary(dir);
});

afterEach(() => {
  lib.close();
  rmSync(dir, { recursive: true, force: true });
});

const image = () => ({ id: `img${Math.random().toString(36).slice(2, 8)}`, width: 800, height: 1000, bytes: 1, placeholder: '#332211', sha256: 'x' });
const render = (entryId: string | null, over: Partial<Parameters<Library['addRender']>[0]> = {}) => ({
  entryId,
  versionId: null,
  backend: 'pollinations' as const,
  model: 'flux',
  prompt: 'a red fox',
  seed: 7,
  width: 1024,
  height: 688,
  file: `render-${Math.random().toString(36).slice(2, 8)}.webp`,
  ...over,
});

describe('renders', () => {
  it('lists an entry’s renders newest first with their media URL', () => {
    const entry = lib.createEntry({ mode: 'image', compress: false, images: [image()] });
    const first = lib.addRender(render(entry.id, { model: 'a' }))!;
    const second = lib.addRender(render(entry.id, { model: 'b' }))!;
    const items = lib.listRenders({ entryId: entry.id, limit: 10, offset: 0 });
    expect(items.map((r) => r.id)).toEqual([second.id, first.id]);
    expect(first.url.startsWith(`/api/media/${entry.id}/render-`)).toBe(true);
    expect(items[0].entrySlug).toBe(entry.slug);
    expect(items[0].entryName).toBe('Untitled');
  });

  it('refuses a render for an entry deleted while it was being made', () => {
    const entry = lib.createEntry({ mode: 'image', compress: false, images: [image()] });
    lib.softDelete(entry.id);
    expect(lib.addRender(render(entry.id))).toBeNull();
    expect(lib.listRenders({ limit: 10, offset: 0 })).toEqual([]);
  });

  it('keeps playground renders without an entry', () => {
    const r = lib.addRender(render(null))!;
    expect(r.entryId).toBeNull();
    expect(r.url.startsWith('/api/media/_playground/render-')).toBe(true);
  });

  it('filters by backend and pages', () => {
    lib.addRender(render(null, { backend: 'keyless-url' }));
    lib.addRender(render(null));
    lib.addRender(render(null));
    expect(lib.listRenders({ backend: 'keyless-url', limit: 10, offset: 0 })).toHaveLength(1);
    expect(lib.listRenders({ limit: 2, offset: 0 })).toHaveLength(2);
    expect(lib.listRenders({ limit: 2, offset: 2 })).toHaveLength(1);
  });

  it('deletes a render and hands back where its file was', () => {
    const entry = lib.createEntry({ mode: 'image', compress: false, images: [image()] });
    const r = lib.addRender(render(entry.id, { file: 'render-abc.webp' }))!;
    expect(lib.deleteRender(r.id)).toEqual({ entryId: entry.id, file: 'render-abc.webp' });
    expect(lib.deleteRender(r.id)).toBeNull();
  });
});

describe('palettes', () => {
  it('puts the measured palette on cards', () => {
    const entry = lib.createEntry({ mode: 'web', compress: false, images: [image()] });
    expect(lib.getEntry(entry.id)!.palette).toBeNull();
    lib.setPalette(entry.id, [{ hex: '#112233', share: 0.6 }, { hex: '#ddeeff', share: 0.4 }]);
    expect(lib.getEntry(entry.id)!.palette).toEqual([{ hex: '#112233', share: 0.6 }, { hex: '#ddeeff', share: 0.4 }]);
    expect(lib.listEntries({}).items[0].palette).toHaveLength(2);
  });

  it('lists only entries still missing a palette', () => {
    const a = lib.createEntry({ mode: 'web', compress: false, images: [image()] });
    const b = lib.createEntry({ mode: 'web', compress: false, images: [image()] });
    lib.setPalette(a.id, [{ hex: '#000000', share: 1 }]);
    const missing = lib.entriesWithoutPalette(10);
    expect(missing.map((m) => m.id)).toEqual([b.id]);
    expect(missing[0].images).toHaveLength(1);
  });

  it('saves rolled palettes newest first, keeps 12, and deletes one', () => {
    const entry = lib.createEntry({ mode: 'image', compress: false, images: [image()] });
    for (let i = 0; i < 14; i++) lib.savePalette(entry.id, [`#00000${i % 10}`]);
    const saved = lib.getEntry(entry.id)!.palettes;
    expect(saved).toHaveLength(12);
    expect(saved[0].colors).toEqual(['#000003']);
    const left = lib.deletePalette(entry.id, saved[0].id);
    expect(left).toHaveLength(11);
    expect(Object.getPrototypeOf(left[0])).toBe(Object.prototype);
  });
});

describe('migration to version 3', () => {
  it('upgrades a version 2 database without losing entries', () => {
    const entry = lib.createEntry({ mode: 'web', compress: false, images: [image()] });
    lib.close();
    const db = new DatabaseSync(join(dir, 'inspi.db'));
    // A real version 2 database has none of the later columns either (v4 added calls.pollen)
    db.exec('DROP TABLE renders; ALTER TABLE entries DROP COLUMN palette; ALTER TABLE entries DROP COLUMN palettes; ALTER TABLE calls DROP COLUMN pollen; PRAGMA user_version = 2;');
    db.close();
    lib = openLibrary(dir);
    expect(lib.getEntry(entry.id)?.id).toBe(entry.id);
    expect(lib.addRender(render(entry.id))).not.toBeNull();
  });
});
