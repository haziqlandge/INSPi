import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { matchPollen, pollenLabel, pollenSpent, syncPollen, type PollenEvent } from '@/lib/ai/pollen';
import { buildUsageReport } from '@/lib/ai/usage';
import { openLibrary, type Library } from '@/lib/store/library';

let dir: string;
let lib: Library;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'inspi-pollen-'));
  lib = openLibrary(dir);
});
afterEach(() => {
  lib.close();
  rmSync(dir, { recursive: true, force: true });
});

const T = Date.parse('2026-10-04T16:09:15.586Z');
const event = (model: string, start: string, cost: number, responseMs = 39_000): PollenEvent => ({ model, at: Date.parse(`${start}Z`.replace(' ', 'T')), responseMs, pollen: cost });

describe('matching INSPi calls to Pollinations usage events', () => {
  it('pairs a call with the same-model event that ended just before it was logged', () => {
    const calls = [{ id: 1, model: 'openai/gpt-image-2', at: T }];
    const events = [event('openai/gpt-image-2', '2026-10-04 16:08:36', 0.0309), event('openai/gpt-image-2', '2026-10-04 15:00:00', 0.03)];
    expect(matchPollen(calls, events)).toEqual([{ id: 1, pollen: 0.0309 }]);
  });

  it('uses each event once, reads community ids with or without their prefix, and leaves strangers alone', () => {
    const calls = [
      { id: 1, model: 'tongyi-mai/z-image-turbo', at: T },
      { id: 2, model: 'tongyi-mai/z-image-turbo', at: T + 2000 },
      { id: 3, model: 'community/MarcosFRG/lucid-origin', at: T },
      { id: 4, model: 'black-forest-labs/flux.1-schnell', at: T },
    ];
    const events = [
      event('tongyi-mai/z-image-turbo', '2026-10-04 16:09:00', 0.004, 10_000),
      event('MarcosFRG/lucid-origin', '2026-10-04 16:09:05', 0.002, 8000),
      event('black-forest-labs/flux.1-schnell', '2026-10-04 15:30:00', 0.002, 9000),
    ];
    expect(matchPollen(calls, events)).toEqual([
      { id: 1, pollen: 0.004 },
      { id: 3, pollen: 0.002 },
    ]);
  });
});

describe('Pollen in the store', () => {
  it('keeps a Pollen amount per call and lists Pollinations calls still without one', () => {
    lib.recordCall({ at: T, provider: 'pollinations', model: 'openai/gpt-image-2', step: 'imagine', entryId: null, tokensIn: 0, tokensOut: 0, ok: true });
    lib.recordCall({ at: T, provider: 'groq', model: 'qwen/qwen3.8-27b', step: 'observe', entryId: null, tokensIn: 10, tokensOut: 5, ok: true });
    const open = lib.unpricedPollinationsCalls(T - 86_400_000);
    expect(open.map((c) => c.model)).toEqual(['openai/gpt-image-2']);
    lib.setCallPollen(open[0].id, 0.0309);
    expect(lib.unpricedPollinationsCalls(T - 86_400_000)).toEqual([]);
    expect(lib.recentCalls(5).find((c) => c.provider === 'pollinations')?.pollen).toBe(0.0309);
  });
});

describe('syncing from Pollinations', () => {
  const usage = (items: unknown[]) => (async () => new Response(JSON.stringify({ usage: items, count: items.length }), { status: 200 })) as unknown as typeof fetch;

  it('writes what Pollinations charged for each call', async () => {
    lib.recordCall({ at: T, provider: 'pollinations', model: 'openai/gpt-image-2', step: 'imagine', entryId: null, tokensIn: 0, tokensOut: 0, ok: true });
    const fetchImpl = usage([{ timestamp: '2026-10-04 16:08:36', model: 'openai/gpt-image-2', cost_usd: 0.03091125, response_time_ms: 39000 }]);
    expect(await syncPollen(lib, { key: 'sk_test', fetchImpl, now: T + 60_000, force: true })).toBe(1);
    expect(lib.recentCalls(1)[0].pollen).toBeCloseTo(0.0309, 4);
  });

  it('never throws when Pollinations cannot be reached', async () => {
    lib.recordCall({ at: T, provider: 'pollinations', model: 'openai/gpt-image-2', step: 'imagine', entryId: null, tokensIn: 0, tokensOut: 0, ok: true });
    const down = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await syncPollen(lib, { key: 'sk_test', fetchImpl: down, now: T + 60_000, force: true })).toBe(0);
  });
});

describe('showing Pollen', () => {
  const call = (over: object) => ({ provider: 'pollinations', model: 'openai/gpt-image-2', step: 'imagine' as const, ok: true, tokensIn: 0, tokensOut: 0, pollen: null, ...over });

  it('says what a Pollinations call cost, as an estimate until Pollinations has said', () => {
    expect(pollenLabel(call({ pollen: 0.0309 }))).toBe('0.031 Pollen');
    expect(pollenLabel(call({}))).toBe('≈0.032 Pollen');
    expect(pollenLabel(call({ provider: 'groq' }))).toBeNull();
    expect(pollenLabel(call({ ok: false }))).toBeNull();
  });

  it('adds up what was spent, estimates included', () => {
    expect(pollenSpent([call({ pollen: 0.03 }), call({}), call({ ok: false })])).toBeCloseTo(0.062, 6);
  });

  it('gives the Pollinations card its balance and the Pollen spent in the last 24 hours', () => {
    const report = buildUsageReport({
      now: T,
      usage: { models: [], days: [] },
      recent: [],
      statuses: [{ id: 'pollinations', label: 'Pollinations', hasKey: true, usable: true, visionModel: 'x', textModel: 'y' } as never],
      cost: () => null,
      pollen: { balance: 4.65, tier: 4.65, paid: 0, spent24h: 0.07 },
    });
    const p = report.providers[0];
    expect(p.pollen).toEqual({ balance: 4.65, tier: 4.65, paid: 0, spent24h: 0.07 });
    expect(p.gauges[0]).toMatchObject({ unit: 'pollen', used: 0.07, limit: 4.72 });
  });
});
