import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { nanoid } from 'nanoid';
import type { Spec, SubjectMode } from '../ai/schema/display';
import { coerceCategory, type Category } from '../library/categories';
import { rankRelated } from '../library/related';
import { slugify, uniqueSlug } from '../library/slug';
import { normalizeTags } from '../library/tags';
import type { BackendId } from '../imagine/types';
import type {
  Collection,
  EntryCard,
  EntryDetail,
  EntryImage,
  EntryStatus,
  EntryVersion,
  Mode,
  PaletteSwatch,
  Render,
  RunChoice,
  SavedPalette,
  Steer,
} from '../types';

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
  /** What the person asked a guided retry to look at, if they did. */
  steer?: Steer | null;
}

/** One request to a provider, kept for the Usage page. */
export interface CallRecord {
  /** Epoch ms. */
  at: number;
  provider: string;
  model: string;
  step: 'observe' | 'translate' | 'imagine';
  entryId: string | null;
  tokensIn: number;
  tokensOut: number;
  ok: boolean;
  /** The kind of failure, such as rate_limit. */
  error?: string | null;
}

export interface UsageWindow {
  tokens: number;
  requests: number;
  refused: number;
}

export interface Usage {
  /** Every provider and model with calls in the period, busiest first. */
  models: { provider: string; model: string; last24h: UsageWindow; utcToday: UsageWindow }[];
  /** One row per UTC day, oldest first, ending today. */
  days: { day: string; tokensIn: number; tokensOut: number; requests: number; refused: number }[];
}

export interface RecentCall extends CallRecord {
  entryName: string | null;
  entrySlug: string | null;
  /** What Pollinations charged, once its usage log has said (see ai/pollen.ts); null otherwise. */
  pollen: number | null;
}

export interface CallFilter {
  since: number;
  provider?: string;
  model?: string;
  step?: CallRecord['step'];
  /** true for answered, false for refused; left out for both. */
  ok?: boolean;
  limit: number;
  offset: number;
}

export interface CallSummary {
  requests: number;
  refused: number;
  tokensIn: number;
  tokensOut: number;
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
  steer: Steer | null;
  /** The provider and models this job was asked to use, or null for the one in use. */
  run: RunChoice | null;  /** Changes from the reference asked for when the entry was added; '' for none. */
  changes: string;
  /** The subject choice asked for when the entry was added, or null. */
  subject: { mode: SubjectMode; text?: string } | null;
}

/** What a new entry's job carries besides guidance and a run. */
export interface JobExtra {
  changes?: string;
  subject?: { mode: SubjectMode; text?: string } | null;
}

function parseRun(raw: unknown): RunChoice | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const run = (JSON.parse(raw) as { run?: RunChoice }).run;
    if (!run || typeof run.provider !== 'string') return null;
    return {
      provider: run.provider,
      ...(typeof run.vision === 'string' ? { vision: run.vision } : {}),
      ...(typeof run.text === 'string' ? { text: run.text } : {}),
    };
  } catch {
    return null;
  }
}

// Version 2: guided retries (jobs.params, versions.steer) and the call log behind the Usage page.
// Versions saved before then are copied into the log as one line each, so history is not empty.
const MIGRATE_TO_2 = `
ALTER TABLE jobs ADD COLUMN params TEXT;
ALTER TABLE versions ADD COLUMN steer TEXT;
CREATE TABLE calls (
  id INTEGER PRIMARY KEY,
  at INTEGER NOT NULL,
  provider TEXT NOT NULL,
  model TEXT NOT NULL,
  step TEXT NOT NULL,
  entry_id TEXT,
  tokens_in INTEGER NOT NULL,
  tokens_out INTEGER NOT NULL,
  ok INTEGER NOT NULL,
  error TEXT
);
CREATE INDEX calls_at ON calls(at);
INSERT INTO calls (at, provider, model, step, entry_id, tokens_in, tokens_out, ok)
  SELECT CAST(unixepoch(created_at, 'subsec') * 1000 AS INTEGER),
         CASE lower(provider) WHEN 'cloudflare workers ai' THEN 'cloudflare' ELSE lower(provider) END,
         model, 'observe', entry_id, tokens_in, tokens_out, 1
  FROM versions;
`;

// Version 3: generated images (Visualize) and the measured and saved palettes.
const MIGRATE_TO_3 = `
CREATE TABLE renders (
  id TEXT PRIMARY KEY,
  entry_id TEXT REFERENCES entries(id) ON DELETE CASCADE,
  version_id TEXT,
  backend TEXT NOT NULL,
  model TEXT NOT NULL,
  prompt TEXT NOT NULL,
  seed INTEGER,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  file TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX renders_entry ON renders(entry_id, created_at);
ALTER TABLE entries ADD COLUMN palette TEXT;
ALTER TABLE entries ADD COLUMN palettes TEXT;
`;

/** v4: what Pollinations charged per request, in Pollen, filled in from its usage log. */
const MIGRATE_TO_4 = `ALTER TABLE calls ADD COLUMN pollen REAL;`;

/** Renders made outside an entry live in this media folder. */
export const PLAYGROUND_DIR = '_playground';
const MAX_SAVED_PALETTES = 12;

export interface RenderInput {
  entryId: string | null;
  versionId: string | null;
  backend: BackendId;
  model: string;
  prompt: string;
  seed: number | null;
  width: number;
  height: number;
  /** File name inside the entry's (or the playground's) media folder. */
  file: string;
}

function parseJsonList<T>(raw: unknown): T[] | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const value = JSON.parse(raw) as unknown;
    return Array.isArray(value) ? (value as T[]) : null;
  } catch {
    return null;
  }
}

const DAY_MS = 86_400_000;

function parseSubject(raw: unknown): { mode: SubjectMode; text?: string } | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const value = JSON.parse(raw) as { subject?: { mode?: unknown; text?: unknown } };
    const mode = value.subject?.mode;
    if (mode !== 'recreate' && mode !== 'mine' && mode !== 'model') return null;
    return typeof value.subject?.text === 'string' ? { mode, text: value.subject.text } : { mode };
  } catch {
    return null;
  }
}

function parseChanges(raw: unknown): string {
  if (typeof raw !== 'string' || !raw) return '';
  try {
    const value = JSON.parse(raw) as { changes?: unknown };
    return typeof value.changes === 'string' ? value.changes : '';
  } catch {
    return '';
  }
}

function parseSteer(raw: unknown): Steer | null {
  if (typeof raw !== 'string' || !raw) return null;
  try {
    const value = JSON.parse(raw) as Steer;
    return { focus: Array.isArray(value.focus) ? value.focus.map(String) : [], note: typeof value.note === 'string' ? value.note : '' };
  } catch {
    return null;
  }
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
    if (version < 2) {
      this.db.exec(`BEGIN; ${MIGRATE_TO_2} PRAGMA user_version = 2; COMMIT;`);
    }
    if (version < 3) {
      this.db.exec(`BEGIN; ${MIGRATE_TO_3} PRAGMA user_version = 3; COMMIT;`);
    }
    if (version < 4) {
      this.db.exec(`BEGIN; ${MIGRATE_TO_4} PRAGMA user_version = 4; COMMIT;`);
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
      palette: parseJsonList<PaletteSwatch>(row.palette)?.map((c) => ({ hex: String(c.hex), share: Number(c.share) })) ?? null,
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
        steer: parseSteer(v.steer),
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
      // node:sqlite rows have a null prototype, which server components cannot pass to client ones.
      collections: this.all<{ id: string; slug: string; name: string }>(
        `SELECT c.id, c.slug, c.name FROM collection_entries ce JOIN collections c ON c.id = ce.collection_id
         WHERE ce.entry_id = ? ORDER BY ce.added_at`,
        card.id,
      ).map((c) => ({ id: c.id, slug: c.slug, name: c.name })),
      palettes: this.savedPalettes(row.palettes),
    };
  }

  private savedPalettes(raw: unknown): SavedPalette[] {
    return (parseJsonList<SavedPalette>(raw) ?? []).map((p) => ({
      id: String(p.id),
      colors: Array.isArray(p.colors) ? p.colors.map(String) : [],
      createdAt: String(p.createdAt),
    }));
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
        `INSERT INTO versions (id, entry_id, n, lens, note, spec_json, provider, model, tokens_in, tokens_out, duration_ms, created_at, steer)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
        v.steer ? JSON.stringify(v.steer) : null,
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

  /** Saves what an image version's reference shows, for Visualize's "Recreate it". False if not an image version. */
  setVersionSubject(versionId: string, subject: string): boolean {
    const row = this.one<{ spec_json: string }>('SELECT spec_json FROM versions WHERE id = ?', versionId);
    if (!row) return false;
    const spec = JSON.parse(row.spec_json) as Spec;
    if (spec.inspi !== 'image/1') return false;
    this.run('UPDATE versions SET spec_json = ? WHERE id = ?', JSON.stringify({ ...spec, subject }), versionId);
    return true;
  }

  /** Changes the prompt an image version gives by default (Copy prompt, Visualize). */
  setVersionSubjectMode(versionId: string, mode: SubjectMode, text = ''): boolean {
    const row = this.one<{ spec_json: string }>('SELECT spec_json FROM versions WHERE id = ?', versionId);
    if (!row) return false;
    const spec = JSON.parse(row.spec_json) as Spec;
    if (spec.inspi !== 'image/1') return false;
    const { mySubject: _old, ...rest } = spec;
    const next = { ...rest, subjectMode: mode, ...(mode === 'mine' && text ? { mySubject: text } : {}) };
    this.run('UPDATE versions SET spec_json = ? WHERE id = ?', JSON.stringify(next), versionId);
    return true;
  }

  // ---------- palettes ----------

  setPalette(entryId: string, palette: PaletteSwatch[]): void {
    this.run('UPDATE entries SET palette = ? WHERE id = ?', JSON.stringify(palette), entryId);
  }

  /** Entries whose colours have not been measured yet, oldest first. */
  entriesWithoutPalette(limit: number): { id: string; images: EntryImage[] }[] {
    return this.all<{ id: string }>(
      'SELECT id FROM entries WHERE palette IS NULL AND deleted_at IS NULL ORDER BY created_at, rowid LIMIT ?',
      limit,
    ).map((r) => ({ id: r.id, images: this.imagesOf(r.id) }));
  }

  /** Keeps a rolled palette on the entry; only the newest twelve are kept. */
  savePalette(entryId: string, colors: string[]): SavedPalette[] {
    const row = this.one<Row>('SELECT palettes FROM entries WHERE id = ?', entryId);
    const saved = [
      { id: nanoid(8), colors: colors.map(String), createdAt: new Date().toISOString() },
      ...this.savedPalettes(row?.palettes),
    ].slice(0, MAX_SAVED_PALETTES);
    this.run('UPDATE entries SET palettes = ? WHERE id = ?', JSON.stringify(saved), entryId);
    return saved;
  }

  deletePalette(entryId: string, paletteId: string): SavedPalette[] {
    const row = this.one<Row>('SELECT palettes FROM entries WHERE id = ?', entryId);
    const saved = this.savedPalettes(row?.palettes).filter((p) => p.id !== paletteId);
    this.run('UPDATE entries SET palettes = ? WHERE id = ?', JSON.stringify(saved), entryId);
    return saved;
  }

  // ---------- renders ----------

  private toRender(r: Row): Render {
    const entryId = (r.entry_id as string | null) ?? null;
    return {
      id: r.id as string,
      entryId,
      entrySlug: (r.slug as string | null) ?? null,
      entryName: (r.name as string | null) ?? null,
      versionId: (r.version_id as string | null) ?? null,
      backend: r.backend as BackendId,
      model: r.model as string,
      prompt: r.prompt as string,
      seed: (r.seed as number | null) ?? null,
      width: r.width as number,
      height: r.height as number,
      url: `/api/media/${entryId ?? PLAYGROUND_DIR}/${r.file as string}`,
      createdAt: r.created_at as string,
    };
  }

  /** Stores a finished render. Returns null if its entry was deleted while it was being made. */
  addRender(input: RenderInput): Render | null {
    if (input.entryId) {
      const alive = this.one<Row>('SELECT id FROM entries WHERE id = ? AND deleted_at IS NULL', input.entryId);
      if (!alive) return null;
    }
    const id = nanoid(12);
    this.run(
      `INSERT INTO renders (id, entry_id, version_id, backend, model, prompt, seed, width, height, file, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      id,
      input.entryId,
      input.versionId,
      input.backend,
      input.model,
      input.prompt,
      input.seed,
      input.width,
      input.height,
      input.file,
      new Date().toISOString(),
    );
    return this.listRenders({ id, limit: 1, offset: 0 })[0];
  }

  listRenders(o: { entryId?: string; backend?: BackendId; id?: string; limit: number; offset: number }): Render[] {
    const where = ['(r.entry_id IS NULL OR e.deleted_at IS NULL)'];
    const params: SQLInputValue[] = [];
    if (o.id) {
      where.push('r.id = ?');
      params.push(o.id);
    }
    if (o.entryId) {
      where.push('r.entry_id = ?');
      params.push(o.entryId);
    }
    if (o.backend) {
      where.push('r.backend = ?');
      params.push(o.backend);
    }
    return this.all<Row>(
      `SELECT r.*, e.slug, e.name FROM renders r LEFT JOIN entries e ON e.id = r.entry_id
       WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC, r.rowid DESC LIMIT ? OFFSET ?`,
      ...params,
      o.limit,
      o.offset,
    ).map((r) => this.toRender(r));
  }

  /** Removes a render and says where its file is, so the caller can delete it. */
  deleteRender(id: string): { entryId: string | null; file: string } | null {
    const row = this.one<Row>('SELECT entry_id, file FROM renders WHERE id = ?', id);
    if (!row) return null;
    this.run('DELETE FROM renders WHERE id = ?', id);
    return { entryId: (row.entry_id as string | null) ?? null, file: row.file as string };
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
  enqueueJob(entryId: string, kind: JobKind, steer: Steer | null = null, run: RunChoice | null = null, extra: JobExtra = {}): boolean {
    const { changes = '', subject = null } = extra;
    if (this.one("SELECT 1 FROM jobs WHERE entry_id = ? AND state IN ('queued', 'running')", entryId)) return false;
    const now = new Date().toISOString();
    this.run(
      "INSERT INTO jobs (id, entry_id, kind, state, created_at, updated_at, params) VALUES (?, ?, ?, 'queued', ?, ?, ?)",
      nanoid(12),
      entryId,
      kind,
      now,
      now,
      steer || run || changes || subject
        ? JSON.stringify({ ...(steer ?? {}), ...(run ? { run } : {}), ...(changes ? { changes } : {}), ...(subject ? { subject } : {}) })
        : null,
    );
    return true;
  }

  takeJob(): Job | null {
    return this.transaction(() => {
      const row = this.one<Row>("SELECT * FROM jobs WHERE state = 'queued' ORDER BY created_at, rowid LIMIT 1");
      if (!row) return null;
      this.run("UPDATE jobs SET state = 'running', updated_at = ? WHERE id = ?", new Date().toISOString(), row.id);
      const steer = parseSteer(row.params);
      return {
        id: row.id as string,
        entryId: row.entry_id as string,
        kind: row.kind as JobKind,
        // A job that only picked a provider carries no guidance.
        steer: steer && (steer.focus.length || steer.note) ? steer : null,
        run: parseRun(row.params),
        changes: parseChanges(row.params),
        subject: parseSubject(row.params),
      };
    });
  }

  finishJob(id: string, state: 'done' | 'failed', error: string | null = null): void {
    this.run('UPDATE jobs SET state = ?, error = ?, updated_at = ? WHERE id = ?', state, error, new Date().toISOString(), id);
  }

  /** After a restart, anything that was mid-flight goes back in the queue. */
  requeueRunningJobs(): void {
    this.run("UPDATE jobs SET state = 'queued' WHERE state = 'running'");
  }

  // ---------- usage ----------

  recordCall(call: CallRecord): void {
    this.run(
      'INSERT INTO calls (at, provider, model, step, entry_id, tokens_in, tokens_out, ok, error) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
      call.at,
      call.provider,
      call.model,
      call.step,
      call.entryId,
      call.tokensIn,
      call.tokensOut,
      call.ok ? 1 : 0,
      call.error ?? null,
    );
  }

  /**
   * Tokens and requests per model for the quota gauges, and per day for the chart. Chart days follow
   * `offsetMs` (the viewer's time zone, east of UTC positive); "utcToday" always follows UTC.
   */
  usage({ now, days, offsetMs = 0 }: { now: number; days: number; offsetMs?: number }): Usage {
    const utcStart = Math.floor(now / DAY_MS) * DAY_MS;
    const dayStart = Math.floor((now + offsetMs) / DAY_MS) * DAY_MS - offsetMs;
    const since = Math.min(now - DAY_MS, utcStart, dayStart - (days - 1) * DAY_MS);
    const rows = this.all<{ at: number; provider: string; model: string; tokens_in: number; tokens_out: number; ok: number }>(
      'SELECT at, provider, model, tokens_in, tokens_out, ok FROM calls WHERE at >= ? AND at <= ? ORDER BY at',
      since,
      now,
    );

    const empty = (): UsageWindow => ({ tokens: 0, requests: 0, refused: 0 });
    const add = (window: UsageWindow, row: (typeof rows)[number]) => {
      window.tokens += row.tokens_in + row.tokens_out;
      if (row.ok) window.requests++;
      else window.refused++;
    };

    const models = new Map<string, Usage['models'][number]>();
    const byDay = new Map<string, Usage['days'][number]>();
    for (let i = days - 1; i >= 0; i--) {
      const day = new Date(dayStart + offsetMs - i * DAY_MS).toISOString().slice(0, 10);
      byDay.set(day, { day, tokensIn: 0, tokensOut: 0, requests: 0, refused: 0 });
    }

    for (const row of rows) {
      const key = `${row.provider}\u0000${row.model}`;
      if (row.at > now - DAY_MS || row.at >= utcStart) {
        let model = models.get(key);
        if (!model) models.set(key, (model = { provider: row.provider, model: row.model, last24h: empty(), utcToday: empty() }));
        if (row.at > now - DAY_MS) add(model.last24h, row);
        if (row.at >= utcStart) add(model.utcToday, row);
      }
      const day = byDay.get(new Date(row.at + offsetMs).toISOString().slice(0, 10));
      if (day) {
        day.tokensIn += row.tokens_in;
        day.tokensOut += row.tokens_out;
        if (row.ok) day.requests++;
        else day.refused++;
      }
    }

    return {
      models: [...models.values()].sort((a, b) => b.last24h.tokens - a.last24h.tokens),
      days: [...byDay.values()],
    };
  }

  /**
   * What one analysis has cost lately on a provider: tokens on `model`, or requests of any kind
   * when `model` is '*requests'. Null until something was analysed there in the window.
   */
  analysisCost(provider: string, model: string, since: number): number | null {
    const { n: analyses } = this.one<{ n: number }>(
      `SELECT count(*) AS n FROM versions
       WHERE (CASE lower(provider) WHEN 'cloudflare workers ai' THEN 'cloudflare' ELSE lower(provider) END) = ?
         AND unixepoch(created_at, 'subsec') * 1000 >= ?`,
      provider,
      since,
    )!;
    if (!analyses) return null;
    const spent =
      model === '*requests'
        ? this.one<{ n: number }>('SELECT count(*) AS n FROM calls WHERE provider = ? AND at >= ?', provider, since)!.n
        : this.one<{ n: number | null }>('SELECT sum(tokens_in + tokens_out) AS n FROM calls WHERE provider = ? AND model = ? AND at >= ?', provider, model, since)!.n ?? 0;
    return spent / analyses;
  }

  /** Image models whose most recent request since `since` failed: not to be suggested by default. */
  failingImageModels(since: number): string[] {
    return this.all<{ model: string }>(
      `SELECT c.model FROM calls c
       WHERE c.step = 'imagine' AND c.at >= ?
         AND c.id = (SELECT MAX(d.id) FROM calls d WHERE d.step = 'imagine' AND d.model = c.model)
         AND c.ok = 0
       ORDER BY c.model`,
      since,
    ).map((r) => r.model);
  }

  /** Answered Pollinations requests since `since` whose Pollen is not known yet (the keyless route costs none). */
  unpricedPollinationsCalls(since: number): { id: number; model: string; at: number }[] {
    return this.all<{ id: number; model: string; at: number }>(
      `SELECT id, model, at FROM calls WHERE provider = 'pollinations' AND ok = 1 AND pollen IS NULL AND model != 'default' AND at >= ? ORDER BY at`,
      since,
    );
  }

  setCallPollen(id: number, pollen: number): void {
    this.run('UPDATE calls SET pollen = ? WHERE id = ?', pollen, id);
  }

  /** Pollinations requests since `since`, for adding up the Pollen they spent. */
  pollinationsCalls(since: number): Pick<RecentCall, 'provider' | 'model' | 'step' | 'ok' | 'pollen'>[] {
    return this.all<Row>(`SELECT provider, model, step, ok, pollen FROM calls WHERE provider = 'pollinations' AND at >= ?`, since).map((row) => ({
      provider: row.provider as string,
      model: row.model as string,
      step: row.step as CallRecord['step'],
      ok: row.ok === 1,
      pollen: typeof row.pollen === 'number' ? row.pollen : null,
    }));
  }

  /**
   * Image models whose every logged request failed with a server error: an HTTP 5xx
   * (`server:5xx`), or `server` from before the status was kept. Rate limits, Pollen, a 4xx
   * and failures on this machine (`internal`) do not count.
   */
  serverOnlyImageModels(): string[] {
    return this.all<{ model: string }>(
      `SELECT model FROM calls WHERE step = 'imagine' GROUP BY model
       HAVING SUM(CASE WHEN ok = 0 AND (error = 'server' OR error LIKE 'server:5%') THEN 1 ELSE 0 END) = COUNT(*)
       ORDER BY model`,
    ).map((r) => r.model);
  }

  recentCalls(limit: number): RecentCall[] {
    return this.all<Row>(
      `SELECT c.*, e.name AS entry_name, e.slug AS entry_slug
       FROM calls c LEFT JOIN entries e ON e.id = c.entry_id AND e.deleted_at IS NULL
       ORDER BY c.at DESC, c.id DESC LIMIT ?`,
      limit,
    ).map((row) => this.toCall(row));
  }

  /**
   * Requests matching every constraint given (provider, model, step, result; any may be left out),
   * newest first, one page at a time, with totals over everything that matched.
   */
  queryCalls(f: CallFilter): { items: RecentCall[]; total: number; summary: CallSummary } {
    const where = ['c.at >= ?'];
    const params: SQLInputValue[] = [f.since];
    if (f.provider) {
      where.push('c.provider = ?');
      params.push(f.provider);
    }
    if (f.model) {
      where.push('c.model = ?');
      params.push(f.model);
    }
    if (f.step) {
      where.push('c.step = ?');
      params.push(f.step);
    }
    if (f.ok !== undefined) {
      where.push('c.ok = ?');
      params.push(f.ok ? 1 : 0);
    }
    const clause = where.join(' AND ');
    const totals = this.one<Row>(
      `SELECT COUNT(*) AS n, COALESCE(SUM(1 - c.ok), 0) AS refused, COALESCE(SUM(c.tokens_in), 0) AS tin, COALESCE(SUM(c.tokens_out), 0) AS tout
       FROM calls c WHERE ${clause}`,
      ...params,
    )!;
    const items = this.all<Row>(
      `SELECT c.*, e.name AS entry_name, e.slug AS entry_slug
       FROM calls c LEFT JOIN entries e ON e.id = c.entry_id AND e.deleted_at IS NULL
       WHERE ${clause} ORDER BY c.at DESC, c.id DESC LIMIT ? OFFSET ?`,
      ...params,
      f.limit,
      f.offset,
    ).map((row) => this.toCall(row));
    return {
      items,
      total: totals.n as number,
      summary: { requests: totals.n as number, refused: totals.refused as number, tokensIn: totals.tin as number, tokensOut: totals.tout as number },
    };
  }

  /** Each provider and model that made requests since `since`, for filter menus. */
  callFacets(since: number): { provider: string; model: string; count: number }[] {
    return this.all<{ provider: string; model: string; n: number }>(
      'SELECT provider, model, COUNT(*) AS n FROM calls WHERE at >= ? GROUP BY provider, model ORDER BY provider, model',
      since,
    ).map((r) => ({ provider: r.provider, model: r.model, count: r.n }));
  }

  private toCall(row: Row): RecentCall {
    return {
      at: row.at as number,
      provider: row.provider as string,
      model: row.model as string,
      step: row.step as CallRecord['step'],
      entryId: (row.entry_id as string | null) ?? null,
      tokensIn: row.tokens_in as number,
      tokensOut: row.tokens_out as number,
      ok: row.ok === 1,
      error: (row.error as string | null) ?? null,
      entryName: (row.entry_name as string | null) ?? null,
      entrySlug: (row.entry_slug as string | null) ?? null,
      pollen: typeof row.pollen === 'number' ? row.pollen : null,
    };
  }
}

export function openLibrary(dataDir: string): Library {
  return new Library(dataDir);
}
