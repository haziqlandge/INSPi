import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildSpec } from '@/lib/ai/schema/expand';
import { openLibrary, type Library } from '@/lib/store/library';
import { sampleObservation, sampleWebTranslation } from './fixtures';

let dir: string;
let lib: Library;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'inspi-steer-'));
  lib = openLibrary(dir);
});

afterEach(() => {
  lib.close();
  rmSync(dir, { recursive: true, force: true });
});

const image = () => ({ id: `img${Math.random().toString(36).slice(2, 8)}`, width: 800, height: 1000, bytes: 1, placeholder: '#332211', sha256: 'x' });

function version(lens = 'balanced', steer?: { focus: string[]; note: string }) {
  const identity = { name: 'Glass Dusk', category: 'Landing Page' as const, tags: ['dusk'] };
  const spec = buildSpec({ mode: 'web', observation: sampleObservation('web'), translation: sampleWebTranslation(), identity });
  return { identity, version: { lens, note: 'n', spec, provider: 'Groq', model: 'm', tokensIn: 10, tokensOut: 5, durationMs: 1, steer } };
}

describe('guided retries in the store', () => {
  it('keeps a job’s guidance until the worker takes it', () => {
    const entry = lib.createEntry({ mode: 'web', compress: false, images: [image()] });
    lib.applyAnalysis(entry.id, version());
    expect(lib.enqueueJob(entry.id, 'retry', { focus: ['typography'], note: 'Heavier headline' })).toBe(true);
    const job = lib.takeJob();
    expect(job?.kind).toBe('retry');
    expect(job?.steer).toEqual({ focus: ['typography'], note: 'Heavier headline' });
  });

  it('has no guidance on an ordinary job', () => {
    const entry = lib.createEntry({ mode: 'web', compress: false, images: [image()] });
    lib.enqueueJob(entry.id, 'analyze');
    expect(lib.takeJob()?.steer).toBeNull();
  });

  it('records the guidance on the version it produced', () => {
    const entry = lib.createEntry({ mode: 'web', compress: false, images: [image()] });
    lib.applyAnalysis(entry.id, version());
    const saved = lib.applyAnalysis(entry.id, version('guided', { focus: ['colour'], note: 'Warmer ground' }));
    expect(saved.versions[0].steer).toBeNull();
    expect(saved.versions[1].steer).toEqual({ focus: ['colour'], note: 'Warmer ground' });
    expect(saved.versions[1].lens).toBe('guided');
  });
});

describe('call records', () => {
  const at = (iso: string) => new Date(iso).getTime();

  it('sums tokens and requests per provider and model over the last day, and per day for the chart', () => {
    const now = at('2026-10-01T12:00:00Z');
    lib.recordCall({ at: at('2026-10-01T11:00:00Z'), provider: 'groq', model: 'qwen', step: 'observe', entryId: null, tokensIn: 3000, tokensOut: 900, ok: true });
    lib.recordCall({ at: at('2026-10-01T11:01:00Z'), provider: 'groq', model: 'gpt', step: 'translate', entryId: null, tokensIn: 2000, tokensOut: 1500, ok: true });
    lib.recordCall({ at: at('2026-10-01T11:02:00Z'), provider: 'groq', model: 'qwen', step: 'observe', entryId: null, tokensIn: 0, tokensOut: 0, ok: false, error: 'rate_limit' });
    lib.recordCall({ at: at('2026-09-29T09:00:00Z'), provider: 'groq', model: 'qwen', step: 'observe', entryId: null, tokensIn: 100, tokensOut: 50, ok: true });
    lib.recordCall({ at: at('2026-10-01T01:00:00Z'), provider: 'openrouter', model: 'gemma', step: 'observe', entryId: null, tokensIn: 10, tokensOut: 10, ok: true });

    const usage = lib.usage({ now, days: 7 });
    const qwen = usage.models.find((m) => m.provider === 'groq' && m.model === 'qwen')!;
    expect(qwen.last24h).toEqual({ tokens: 3900, requests: 1, refused: 1 });
    expect(qwen.utcToday).toEqual({ tokens: 3900, requests: 1, refused: 1 });
    expect(usage.models.find((m) => m.model === 'gpt')!.last24h.tokens).toBe(3500);

    expect(usage.days).toHaveLength(7);
    expect(usage.days.at(-1)).toMatchObject({ day: '2026-10-01', tokensIn: 5010, tokensOut: 2410, requests: 3, refused: 1 });
    expect(usage.days.find((d) => d.day === '2026-09-29')).toMatchObject({ tokensIn: 100, tokensOut: 50, requests: 1 });
    expect(usage.days.find((d) => d.day === '2026-09-30')).toMatchObject({ tokensIn: 0, requests: 0 });
  });

  it('lists recent calls newest first with the entry’s name', () => {
    const entry = lib.createEntry({ mode: 'web', compress: false, images: [image()] });
    lib.applyAnalysis(entry.id, version());
    lib.recordCall({ at: 1000, provider: 'groq', model: 'qwen', step: 'observe', entryId: entry.id, tokensIn: 1, tokensOut: 1, ok: true });
    lib.recordCall({ at: 2000, provider: 'groq', model: 'gpt', step: 'translate', entryId: entry.id, tokensIn: 1, tokensOut: 1, ok: true });
    const recent = lib.recentCalls(10);
    expect(recent.map((c) => c.step)).toEqual(['translate', 'observe']);
    expect(recent[0].entryName).toBe('Glass Dusk');
    expect(recent[0].entrySlug).toBe('glass-dusk');
  });
});

describe('upgrading a database from before these features', () => {
  it('adds the new columns and table, and counts past versions as usage', () => {
    const entry = lib.createEntry({ mode: 'web', compress: false, images: [image()] });
    lib.applyAnalysis(entry.id, version());
    lib.close();

    const raw = new DatabaseSync(join(dir, 'inspi.db'));
    raw.exec('DROP TABLE renders; ALTER TABLE entries DROP COLUMN palette; ALTER TABLE entries DROP COLUMN palettes; ALTER TABLE jobs DROP COLUMN params; ALTER TABLE versions DROP COLUMN steer; DROP TABLE calls; PRAGMA user_version = 1;');
    raw.close();

    lib = openLibrary(dir);
    expect(lib.enqueueJob(entry.id, 'retry', { focus: [], note: 'x' })).toBe(true);
    expect(lib.takeJob()?.steer).toEqual({ focus: [], note: 'x' });
    const usage = lib.usage({ now: Date.now(), days: 2 });
    expect(usage.models).toEqual([expect.objectContaining({ provider: 'groq', last24h: { tokens: 15, requests: 1, refused: 0 } })]);
  });
});

describe('what an analysis costs', () => {
  it('divides recent tokens on a model, or requests, by the analyses made', () => {
    const entry = lib.createEntry({ mode: 'web', compress: false, images: [image()] });
    lib.applyAnalysis(entry.id, version());
    lib.applyAnalysis(entry.id, version());
    const now = Date.now();
    lib.recordCall({ at: now, provider: 'groq', model: 'qwen', step: 'observe', entryId: entry.id, tokensIn: 3000, tokensOut: 1000, ok: true });
    lib.recordCall({ at: now, provider: 'groq', model: 'qwen', step: 'observe', entryId: entry.id, tokensIn: 0, tokensOut: 0, ok: false, error: 'rate_limit' });
    lib.recordCall({ at: now, provider: 'groq', model: 'gpt', step: 'translate', entryId: entry.id, tokensIn: 1000, tokensOut: 1000, ok: true });
    expect(lib.analysisCost('groq', 'qwen', now - 1000)).toBe(2000);
    expect(lib.analysisCost('groq', '*requests', now - 1000)).toBe(1.5);
    expect(lib.analysisCost('openrouter', 'x', now - 1000)).toBeNull();
  });
});

describe('chart days in the viewer’s time zone', () => {
  it('puts a call made just after local midnight on the local day', () => {
    // 00:21 on 1 Oct in India (UTC+5:30) is 18:51 on 30 Sep in UTC.
    const at = Date.parse('2026-09-30T18:51:00Z');
    lib.recordCall({ at, provider: 'groq', model: 'qwen', step: 'observe', entryId: null, tokensIn: 5, tokensOut: 5, ok: true });
    const usage = lib.usage({ now: at + 60_000, days: 2, offsetMs: 330 * 60_000 });
    expect(usage.days.map((d) => [d.day, d.tokensIn])).toEqual([
      ['2026-09-30', 0],
      ['2026-10-01', 5],
    ]);
    expect(usage.models[0].utcToday.tokens).toBe(10);
  });
});
