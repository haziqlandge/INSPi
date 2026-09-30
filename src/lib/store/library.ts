import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { nanoid } from 'nanoid';
import type { Spec } from '../ai/schema/display';
import { coerceCategory, type Category } from '../library/categories';
import { rankRelated } from '../library/related';
import { slugify, uniqueSlug } from '../library/slug';
import { normalizeTags } from '../library/tags';
import type { Collection, EntryCard, EntryDetail, EntryImage, EntryStatus, EntryVersion, Mode } from '../types';

export interface NewImage {
  id: string;
  width: number;
  height: number;
  bytes: number;
  placeholder: string;
  sha256: string;
}

export interface EntryFilter {
  q?: string;
  category?: string;
  tag?: string;
  mode?: Mode;
  favorite?: boolean;
  collectionId?: string;
  limit?: number;
  offset?: number;
}

export interface VersionInput {
  lens: string;
  note: string;
  spec: Spec;
  provider: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
}

export interface Identity {
  name: string;
  category: Category;
  tags: string[];
}

export type JobKind = 'analyze' | 'retry';
export interface Job {
  id: string;
  entryId: string;
  kind: JobKind;
}

const SCHEMA = `
CREATE TABLE entries (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL,
  progress TEXT,
  wait_until INTEGER,
  error TEXT,
  compress INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  active_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  owner_id TEXT
);
CREATE TABLE images (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  bytes INTEGER NOT NULL,
  placeholder TEXT NOT NULL,
  sha256 TEXT NOT NULL
);
CREATE INDEX images_entry ON images(entry_id, position);
CREATE TABLE versions (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  n INTEGER NOT NULL,
  lens TEXT NOT NULL,
  note TEXT NOT NULL,
  spec_json TEXT NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  duration_ms INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX versions_entry ON versions(entry_id, n);
CREATE TABLE tags (id INTEGER PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE entry_tags (
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  PRIMARY KEY (entry_id, tag_id)
);
CREATE TABLE collections (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE collection_entries (
  collection_id TEXT NOT NULL REFERENCES collections(id) ON DELETE CASCADE,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  added_at TEXT NOT NULL,
  PRIMARY KEY (collection_id, entry_id)
);
CREATE TABLE jobs (
  id TEXT PRIMARY KEY,
  entry_id TEXT NOT NULL REFERENCES entries(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  state TEXT NOT NULL,
  error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`;

type Row = Record<string, SQLInputValue>;

const escapeLike = (term: string) => term.replace(/[\\%_]/g, (ch) => `\\${ch}`);

/** Small deterministic generator so a Discover feed keeps its order while it is paged. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class Library {
  private db: DatabaseSync;

  constructor(dataDir: string) {
    mkdirSync(dataDir, { recursive: true });
    this.db = new DatabaseSync(join(dataDir, 'inspi.db'));
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');
    const { user_version: version } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (version < 1) {
      this.db.exec(`BEGIN; ${SCHEMA} PRAGMA user_version = 1; COMMIT;`);
    }
  }

  close(): void {
    this.db.close();
  }

  private all<T>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.db.prepare(sql).all(...params) as T[];
  }

  private one<T>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.db.prepare(sql).get(...params) as T | undefined;
  }

  private run(sql: string, ...params: SQLInputValue[]): void {
    this.db.prepare(sql).run(...params);
  }

  private transaction<T>(work: () => T): T {
    this.db.exec('BEGIN');
    try {
      const result = work();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  // ---------- reading ----------

  private imagesOf(entryId: string): EntryImage[] {
    return this.all<Row>('SELECT * FROM images WHERE entry_id = ? ORDER BY position', entryId).map((r) => ({
      id: r.id as string,
      position: r.position as number,
      width: r.width as number,
      height: r.height as number,
      placeholder: r.placeholder as string,
      full: `/api/media/${entryId}/${r.id}.webp`,
      thumb: `/api/media/${entryId}/${r.id}.thumb.webp`,
    }));
  }

  private tagsOf(entryId: string): string[] {
    return this.all<{ name: string }>(
      'SELECT t.name FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = ? ORDER BY et.position',
      entryId,
    ).map((r) => r.name);
  }

  private toCard(row: Row): EntryCard {
    const id = row.id as string;
    const images = this.imagesOf(id);
    return {
      id,
      slug: row.slug as string,
      name: row.name as string,
      category: coerceCategory(row.category),
      mode: row.mode as Mode,
      status: row.status as EntryStatus,
      progress: (row.progress as string | null) ?? null,
      waitUntil: (row.wait_until as number | null) ?? null,
      error: (row.error as string | null) ?? null,
      favorite: row.favorite === 1,
      tags: this.tagsOf(id),
      imageCount: images.length,
      cover: images[0] ?? null,
      hasPrompt: row.active_version_id != null,
      createdAt: row.created_at as string,
    };
  }

  private toDetail(row: Row): EntryDetail {
    const card = this.toCard(row);
    const versions = this.all<Row>('SELECT * FROM versions WHERE entry_id = ? ORDER BY n', card.id).map(
      (v): EntryVersion => ({
        id: v.id as string,
        n: v.n as number,
        lens: v.lens as string,
        note: v.note as string,
        spec: JSON.parse(v.spec_json as string) as Spec,
        provider: v.provider as string,
        model: v.model as string,
        createdAt: v.created_at as string,
      }),
    );
    return {
      ...card,
      compress: row.compress === 1,
      images: this.imagesOf(card.id),
      versions,
      activeVersionId: (row.active_version_id as string | null) ?? null,
      collectionIds: this.all<{ collection_id: string }>(
        'SELECT collection_id FROM collection_entries WHERE entry_id = ? ORDER BY added_at',
        card.id,
      ).map((r) => r.collection_id),
      collections: this.all<{ id: string; slug: string; name: string }>(
        `SELECT c.id, c.slug, c.name FROM collection_entries ce JOIN collections c ON c.id = ce.collection_id
         WHERE ce.entry_id = ? ORDER BY ce.added_at`,
        card.id,
      ),
    };
  }

  getEntry(idOrSlug: string): EntryDetail | null {
    const row = this.one<Row>(
      'SELECT * FROM entries WHERE (id = ? OR slug = ?) AND deleted_at IS NULL',
      idOrSlug,
      idOrSlug,
    );
    return row ? this.toDetail(row) : null;
  }

  listEntries(filter: EntryFilter): { items: EntryCard[]; total: number } {
    const where = ['e.deleted_at IS NULL'];
    const params: SQLInputValue[] = [];

    if (filter.category) {
      where.push('e.category = ?');
      params.push(filter.category);
    }
    if (filter.mode) {
      where.push('e.mode = ?');
      params.push(filter.mode);
    }
    if (filter.favorite) where.push('e.favorite = 1');
    // "a,b" narrows to entries that have both tags.
    for (const tag of (filter.tag ?? '').split(',').map((t) => t.trim()).filter(Boolean).slice(0, 8)) {
      where.push('EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id AND t.name = ?)');
      params.push(tag);
    }
    if (filter.collectionId) {
      where.push('EXISTS (SELECT 1 FROM collection_entries ce WHERE ce.entry_id = e.id AND ce.collection_id = ?)');
      params.push(filter.collectionId);
    }
    for (const term of (filter.q ?? '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8)) {
      const like = `%${escapeLike(term)}%`;
      where.push(`(
        lower(e.name) LIKE ? ESCAPE '\\' OR lower(e.category) LIKE ? ESCAPE '\\'
        OR EXISTS (SELECT 1 FROM entry_tags et JOIN tags t ON t.id = et.tag_id WHERE et.entry_id = e.id AND t.name LIKE ? ESCAPE '\\')
        OR EXISTS (SELECT 1 FROM versions v WHERE v.id = e.active_version_id AND lower(v.note) LIKE ? ESCAPE '\\')
      )`);
      params.push(like, like, like, like);
    }

    const clause = where.join(' AND ');
    const { n: total } = this.one<{ n: number }>(`SELECT count(*) AS n FROM entries e WHERE ${clause}`, ...params)!;
    const limit = Math.min(Math.max(filter.limit ?? 60, 1), 200);
    const offset = Math.max(filter.offset ?? 0, 0);
    const rows = this.all<Row>(
      `SELECT e.* FROM entries e WHERE ${clause} ORDER BY e.created_at DESC, e.rowid DESC LIMIT ? OFFSET ?`,
      ...params,
      limit,
      offset,
    );
    return { items: rows.map((r) => this.toCard(r)), total };
  }

  private readyCards(): EntryCard[] {
    return this.all<Row>(
      "SELECT * FROM entries WHERE deleted_at IS NULL AND status = 'ready' ORDER BY created_at DESC, rowid DESC",
    ).map((r) => this.toCard(r));
  }

  related(id: string, limit: number): EntryCard[] {
    const target = this.getEntry(id);
    if (!target) return [];
    return rankRelated(target, this.readyCards(), limit);
  }

  discover(o: { exclude: string[]; limit: number; offset: number; seed: number }): EntryCard[] {
    const random = mulberry32(o.seed);
    const pool = this.readyCards().filter((c) => !o.exclude.includes(c.id));
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [pool[i], pool[j]] = [pool[j], pool[i]];
    }
    return pool.slice(o.offset, o.offset + o.limit);
  }

  topTags(limit: number): { name: string; count: number }[] {
    return this.all<{ name: string; count: number }>(
      `SELECT t.name AS name, count(*) AS count
       FROM entry_tags et JOIN tags t ON t.id = et.tag_id JOIN entries e ON e.id = et.entry_id
       WHERE e.deleted_at IS NULL GROUP BY t.id ORDER BY count DESC, t.name LIMIT ?`,
      limit,
    );
  }

  /** Every tag in use with its entry count, for the tag browser. */
  allTags(): { name: string; count: number }[] {
    return this.topTags(1000);
  }

  /** How many entries each category holds, largest first: the library's index. */
  categoryCounts(): { name: string; count: number }[] {
    return this.all<{ name: string; count: number }>(
      "SELECT category AS name, count(*) AS count FROM entries WHERE deleted_at IS NULL AND status = 'ready' GROUP BY category ORDER BY count DESC, category",
    );
  }

  // ---------- writing ----------

  private slugTaken(slug: string, exceptId?: string): boolean {
    return Boolean(this.one('SELECT 1 FROM entries WHERE slug = ? AND id IS NOT ?', slug, exceptId ?? null));
  }

  private writeTags(entryId: string, tags: string[]): void {
    this.run('DELETE FROM entry_tags WHERE entry_id = ?', entryId);
    tags.forEach((name, position) => {
      this.run('INSERT OR IGNORE INTO tags (name) VALUES (?)', name);
      const { id } = this.one<{ id: number }>('SELECT id FROM tags WHERE name = ?', name)!;
      this.run('INSERT INTO entry_tags (entry_id, tag_id, position) VALUES (?, ?, ?)', entryId, id, position);
    });
    this.run('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM entry_tags)');
  }

  createEntry(input: { mode: Mode; compress: boolean; images: NewImage[]; id?: string }): EntryDetail {
    const id = input.id ?? nanoid(12);
    const now = new Date().toISOString();
    this.transaction(() => {
      this.run(
        `INSERT INTO entries (id, slug, name, category, mode, status, compress, created_at, updated_at)
         VALUES (?, ?, 'Untitled', ?, ?, 'queued', ?, ?, ?)`,
        id,
        `untitled-${id.toLowerCase()}`,
        coerceCategory(null),
        input.mode,
        input.compress ? 1 : 0,
        now,
        now,
      );
      input.images.forEach((image, position) => {
        this.run(
          'INSERT INTO images (id, entry_id, position, width, height, bytes, placeholder, sha256) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          image.id,
          id,
          position,
          image.width,
          image.height,
          image.bytes,
          image.placeholder,
          image.sha256,
        );
      });
    });
    return this.getEntry(id)!;
  }

  setProgress(
    id: string,
    p: { status?: EntryStatus; progress?: string | null; waitUntil?: number | null; error?: string | null },
  ): void {
    const current = this.one<Row>('SELECT status, progress, wait_until, error FROM entries WHERE id = ?', id);
    if (!current) return;
    this.run(
      'UPDATE entries SET status = ?, progress = ?, wait_until = ?, error = ?, updated_at = ? WHERE id = ?',
      p.status ?? (current.status as string),
      p.progress === undefined ? current.progress : p.progress,
      p.waitUntil === undefined ? current.wait_until : p.waitUntil,
      p.error === undefined ? current.error : p.error,
      new Date().toISOString(),
      id,
    );
  }

  /** Saves an analysis as a new active version. The first one also names, categorises and tags the entry. */
  applyAnalysis(id: string, input: { identity: Identity; version: VersionInput; collections?: string[] }): EntryDetail {
    return this.transaction(() => {
      const row = this.one<Row>('SELECT * FROM entries WHERE id = ?', id);
      if (!row) throw new Error('Entry not found.');
      const { n: count } = this.one<{ n: number }>('SELECT count(*) AS n FROM versions WHERE entry_id = ?', id)!;
      const now = new Date().toISOString();
      const versionId = nanoid(12);
      const v = input.version;

      if (count === 0) {
        const tags = normalizeTags(input.identity.tags);
        const slug = uniqueSlug(slugify(input.identity.name), (s) => this.slugTaken(s, id));
        this.run(
          'UPDATE entries SET name = ?, category = ?, slug = ? WHERE id = ?',
          input.identity.name,
          input.identity.category,
          slug,
          id,
        );
        this.writeTags(id, tags);
        for (const name of input.collections ?? []) this.addToCollection(this.collectionNamed(name).id, id);
      }

      this.run(
        `INSERT INTO versions (id, entry_id, n, lens, note, spec_json, provider, model, tokens_in, tokens_out, duration_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        versionId,
        id,
        count + 1,
        v.lens,
        v.note,
        JSON.stringify(v.spec),
        v.provider,
        v.model,
        v.tokensIn,
        v.tokensOut,
        v.durationMs,
        now,
      );
      this.run(
        "UPDATE entries SET status = 'ready', progress = NULL, wait_until = NULL, error = NULL, active_version_id = ?, updated_at = ? WHERE id = ?",
        versionId,
        now,
        id,
      );
      return this.toDetail(this.one<Row>('SELECT * FROM entries WHERE id = ?', id)!);
    });
  }

  updateEntry(
    id: string,
    patch: { name?: string; category?: string; tags?: unknown; favorite?: boolean; activeVersionId?: string },
  ): EntryDetail | null {
    return this.transaction(() => {
      const current = this.getEntry(id);
      if (!current) return null;

      const name = patch.name?.trim().slice(0, 60) || current.name;
      const category = patch.category === undefined ? current.category : coerceCategory(patch.category);
      const tags = patch.tags === undefined ? current.tags : normalizeTags(patch.tags, 20);
      const slug = name === current.name ? current.slug : uniqueSlug(slugify(name), (s) => this.slugTaken(s, id));

      if (patch.activeVersionId !== undefined && !current.versions.some((v) => v.id === patch.activeVersionId)) {
        throw new Error('That version does not belong to this entry.');
      }

      this.run(
        'UPDATE entries SET name = ?, slug = ?, category = ?, favorite = ?, active_version_id = ?, updated_at = ? WHERE id = ?',
        name,
        slug,
        category,
        (patch.favorite ?? current.favorite) ? 1 : 0,
        patch.activeVersionId ?? current.activeVersionId,
        new Date().toISOString(),
        id,
      );

      const identityChanged =
        name !== current.name || category !== current.category || tags.join('|') !== current.tags.join('|');
      if (identityChanged) {
        this.writeTags(id, tags);
        // The JSON a user copies carries the entry's name, category and tags, so keep it in step.
        for (const version of current.versions) {
          const spec = { ...version.spec, name, category, tags };
          this.run('UPDATE versions SET spec_json = ? WHERE id = ?', JSON.stringify(spec), version.id);
        }
      }
      return this.getEntry(id);
    });
  }

  softDelete(id: string): void {
    this.run('UPDATE entries SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', new Date().toISOString(), id);
  }

  restore(id: string): void {
    this.run('UPDATE entries SET deleted_at = NULL WHERE id = ?', id);
  }

  /** Permanently removes entries deleted at least `olderThanMs` ago; returns their ids so files can follow. */
  purgeDeleted(olderThanMs: number): string[] {
    const cutoff = new Date(Date.now() - olderThanMs).toISOString();
    const ids = this.all<{ id: string }>(
      'SELECT id FROM entries WHERE deleted_at IS NOT NULL AND deleted_at <= ?',
      cutoff,
    ).map((r) => r.id);
    for (const id of ids) this.run('DELETE FROM entries WHERE id = ?', id);
    if (ids.length) this.run('DELETE FROM tags WHERE id NOT IN (SELECT tag_id FROM entry_tags)');
    return ids;
  }

  // ---------- collections ----------

  private collectionSlugTaken(slug: string, exceptId?: string): boolean {
    return Boolean(this.one('SELECT 1 FROM collections WHERE slug = ? AND id IS NOT ?', slug, exceptId ?? null));
  }

  private toCollection(row: Row): Collection {
    const id = row.id as string;
    const entryIds = this.all<{ entry_id: string }>(
      `SELECT ce.entry_id FROM collection_entries ce JOIN entries e ON e.id = ce.entry_id
       WHERE ce.collection_id = ? AND e.deleted_at IS NULL ORDER BY ce.added_at DESC`,
      id,
    ).map((r) => r.entry_id);
    const covers = entryIds
      .slice(0, 4)
      .map((entryId) => this.imagesOf(entryId)[0])
      .filter(Boolean);
    return {
      id,
      slug: row.slug as string,
      name: row.name as string,
      count: entryIds.length,
      covers,
      createdAt: row.created_at as string,
    };
  }

  listCollections(): Collection[] {
    return this.all<Row>('SELECT * FROM collections ORDER BY created_at DESC, rowid DESC').map((r) => this.toCollection(r));
  }

  getCollection(idOrSlug: string): Collection | null {
    const row = this.one<Row>('SELECT * FROM collections WHERE id = ? OR slug = ?', idOrSlug, idOrSlug);
    return row ? this.toCollection(row) : null;
  }

  /** The collection with this name (case-insensitive), made if it does not exist yet. */
  collectionNamed(name: string): Collection {
    const clean = name.trim().slice(0, 60);
    const row = this.one<Row>('SELECT * FROM collections WHERE lower(name) = lower(?)', clean);
    return row ? this.toCollection(row) : this.createCollection(clean);
  }

  collectionNames(): string[] {
    return this.all<{ name: string }>('SELECT name FROM collections ORDER BY created_at, rowid').map((r) => r.name);
  }

  createCollection(name: string): Collection {
    const clean = name.trim().slice(0, 60) || 'Untitled collection';
    const id = nanoid(10);
    const slug = uniqueSlug(slugify(clean), (s) => this.collectionSlugTaken(s));
    this.run('INSERT INTO collections (id, slug, name, created_at) VALUES (?, ?, ?, ?)', id, slug, clean, new Date().toISOString());
    return this.getCollection(id)!;
  }

  renameCollection(id: string, name: string): Collection | null {
    const clean = name.trim().slice(0, 60);
    if (!clean || !this.getCollection(id)) return this.getCollection(id);
    const slug = uniqueSlug(slugify(clean), (s) => this.collectionSlugTaken(s, id));
    this.run('UPDATE collections SET name = ?, slug = ? WHERE id = ?', clean, slug, id);
    return this.getCollection(id);
  }

  deleteCollection(id: string): void {
    this.run('DELETE FROM collections WHERE id = ?', id);
  }

  addToCollection(collectionId: string, entryId: string): void {
    this.run(
      'INSERT OR IGNORE INTO collection_entries (collection_id, entry_id, added_at) VALUES (?, ?, ?)',
      collectionId,
      entryId,
      new Date().toISOString(),
    );
  }

  removeFromCollection(collectionId: string, entryId: string): void {
    this.run('DELETE FROM collection_entries WHERE collection_id = ? AND entry_id = ?', collectionId, entryId);
  }

  // ---------- settings ----------

  getSetting<T>(key: string, fallback: T): T {
    const row = this.one<{ value: string }>('SELECT value FROM settings WHERE key = ?', key);
    if (!row) return fallback;
    try {
      return JSON.parse(row.value) as T;
    } catch {
      return fallback;
    }
  }

  setSetting(key: string, value: unknown): void {
    this.run(
      'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
      key,
      JSON.stringify(value),
    );
  }

  // ---------- jobs ----------

  /** False when the entry already has a job waiting or running. */
  enqueueJob(entryId: string, kind: JobKind): boolean {
    if (this.one("SELECT 1 FROM jobs WHERE entry_id = ? AND state IN ('queued', 'running')", entryId)) return false;
    const now = new Date().toISOString();
    this.run(
      "INSERT INTO jobs (id, entry_id, kind, state, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?)",
      nanoid(12),
      entryId,
      kind,
      now,
      now,
    );
    return true;
  }

  takeJob(): Job | null {
    return this.transaction(() => {
      const row = this.one<Row>("SELECT * FROM jobs WHERE state = 'queued' ORDER BY created_at, rowid LIMIT 1");
      if (!row) return null;
      this.run("UPDATE jobs SET state = 'running', updated_at = ? WHERE id = ?", new Date().toISOString(), row.id);
      return { id: row.id as string, entryId: row.entry_id as string, kind: row.kind as JobKind };
    });
  }

  finishJob(id: string, state: 'done' | 'failed', error: string | null = null): void {
    this.run('UPDATE jobs SET state = ?, error = ?, updated_at = ? WHERE id = ?', state, error, new Date().toISOString(), id);
  }

  /** After a restart, anything that was mid-flight goes back in the queue. */
  requeueRunningJobs(): void {
    this.run("UPDATE jobs SET state = 'queued' WHERE state = 'running'");
  }
}

export function openLibrary(dataDir: string): Library {
  return new Library(dataDir);
}
