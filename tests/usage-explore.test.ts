import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openLibrary, type CallRecord, type Library } from '@/lib/store/library';

let dir: string;
let lib: Library;
const NOW = Date.UTC(2026, 9, 3, 18, 0, 0);
const HOUR = 3_600_000;

function call(over: Partial<CallRecord>): void {
  lib.recordCall({ at: NOW - HOUR, provider: 'groq', model: 'qwen', step: 'observe', entryId: null, tokensIn: 100, tokensOut: 50, ok: true, error: null, ...over });
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'inspi-explore-'));
  lib = openLibrary(dir);
  call({});
  call({ step: 'translate', model: 'gpt-oss', at: NOW - 2 * HOUR });
  call({ provider: 'openrouter', model: 'gemma', ok: false, error: 'rate_limit', tokensIn: 0, tokensOut: 0, at: NOW - 3 * HOUR });
  call({ provider: 'pollinations', model: 'flux', step: 'imagine', tokensIn: 0, tokensOut: 0, at: NOW - 30 * HOUR });
  for (let i = 0; i < 12; i++) call({ at: NOW - (40 + i) * HOUR });
});

afterEach(() => {
  lib.close();
  rmSync(dir, { recursive: true, force: true });
});

describe('queryCalls', () => {
  it('filters by provider alone, model alone, both, or neither', () => {
    const since = NOW - 7 * 24 * HOUR;
    expect(lib.queryCalls({ since, limit: 100, offset: 0 }).total).toBe(16);
    expect(lib.queryCalls({ since, provider: 'groq', limit: 100, offset: 0 }).total).toBe(14);
    expect(lib.queryCalls({ since, model: 'gpt-oss', limit: 100, offset: 0 }).total).toBe(1);
    expect(lib.queryCalls({ since, provider: 'openrouter', model: 'qwen', limit: 100, offset: 0 }).total).toBe(0);
  });

  it('filters by step and result, newest first, in pages', () => {
    const since = NOW - 7 * 24 * HOUR;
    expect(lib.queryCalls({ since, step: 'imagine', limit: 10, offset: 0 }).items.map((c) => c.model)).toEqual(['flux']);
    expect(lib.queryCalls({ since, ok: false, limit: 10, offset: 0 }).items.map((c) => c.error)).toEqual(['rate_limit']);
    const first = lib.queryCalls({ since, limit: 10, offset: 0 });
    const second = lib.queryCalls({ since, limit: 10, offset: 10 });
    expect(first.items).toHaveLength(10);
    expect(second.items).toHaveLength(6);
    expect(first.items[0].at).toBeGreaterThan(first.items[9].at);
  });

  it('only counts calls inside the time range', () => {
    expect(lib.queryCalls({ since: NOW - 24 * HOUR, limit: 100, offset: 0 }).total).toBe(3);
  });

  it('sums what matched', () => {
    const { summary } = lib.queryCalls({ since: NOW - 24 * HOUR, limit: 1, offset: 0 });
    expect(summary).toEqual({ requests: 3, refused: 1, tokensIn: 200, tokensOut: 100 });
  });
});

describe('callFacets', () => {
  it('lists the providers and models seen in the range, for the filter menus', () => {
    expect(lib.callFacets(NOW - 7 * 24 * HOUR)).toEqual([
      { provider: 'groq', model: 'gpt-oss', count: 1 },
      { provider: 'groq', model: 'qwen', count: 13 },
      { provider: 'openrouter', model: 'gemma', count: 1 },
      { provider: 'pollinations', model: 'flux', count: 1 },
    ]);
  });
});

describe('daySeries', () => {
  it('buckets requests into the viewer’s calendar days, oldest first, including empty days', async () => {
    const { daySeries } = await import('@/lib/ai/usage');
    const calls = [
      { at: NOW - HOUR, ok: true, tokensIn: 10, tokensOut: 5 },
      { at: NOW - 2 * HOUR, ok: false, tokensIn: 0, tokensOut: 0 },
      { at: NOW - 25 * HOUR, ok: true, tokensIn: 1, tokensOut: 1 },
    ];
    expect(daySeries(calls, 3, NOW, 0)).toEqual([
      { day: '2026-10-01', tokensIn: 0, tokensOut: 0, requests: 0, refused: 0 },
      { day: '2026-10-02', tokensIn: 1, tokensOut: 1, requests: 1, refused: 0 },
      { day: '2026-10-03', tokensIn: 10, tokensOut: 5, requests: 2, refused: 1 },
    ]);
  });
});
