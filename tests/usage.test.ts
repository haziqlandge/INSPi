import { describe, expect, it } from 'vitest';
import type { ProviderStatus } from '@/lib/ai/status';
import { buildUsageReport } from '@/lib/ai/usage';

const status = (id: ProviderStatus['id'], extra: Partial<ProviderStatus> = {}): ProviderStatus => ({
  id,
  label: id,
  note: '',
  keyEnv: [],
  keyUrl: '',
  hasKey: true,
  hasFallbackKey: false,
  duplicateFallbackKey: false,
  verified: true,
  visionModel: `${id}-vision`,
  textModel: `${id}-text`,
  defaultVision: '',
  defaultText: '',
  usable: true,
  tokensPerMinute: 8000,
  rate: null,
  ...extra,
});

const window = (tokens: number, requests = 1, refused = 0) => ({ tokens, requests, refused });

describe('usage report', () => {
  const now = 1_000_000;
  const usage = {
    models: [
      { provider: 'groq', model: 'groq-vision', last24h: window(150_000), utcToday: window(100_000) },
      { provider: 'groq', model: 'groq-text', last24h: window(20_000), utcToday: window(20_000) },
      { provider: 'openrouter', model: 'gemma', last24h: window(10, 3, 2), utcToday: window(10, 3, 2) },
    ],
    days: [],
  };

  it('gives Groq a token gauge per model and estimates analyses left from the tighter one', () => {
    const report = buildUsageReport({
      now,
      usage,
      recent: [],
      statuses: [status('groq', { rate: { remainingTokens: 3000, limitTokens: 8000, resetTokensMs: 20_000, at: now - 5000 } }), status('openrouter')],
      cost: (_p, model) => (model === 'groq-vision' ? 10_000 : 4000),
    });
    const groq = report.providers[0];
    expect(groq.inUse).toBe(true);
    expect(groq.gauges.map((g) => [g.label, g.used, g.limit])).toEqual([
      ['groq-vision', 150_000, 200_000],
      ['groq-text', 20_000, 200_000],
    ]);
    expect(groq.analysesLeft).toBe(5);
    expect(groq.minute).toEqual({ remainingTokens: 3000, limitTokens: 8000, resetsInMs: 15_000, at: now - 5000 });
    expect(report.providers[1].inUse).toBe(false);
  });

  it('prefers OpenRouter’s own count of free requests, and falls back to the log', () => {
    const base = { now, usage, recent: [], statuses: [status('openrouter')], cost: () => 2 };
    expect(buildUsageReport({ ...base, openrouterFree: { used: 7, limit: 1000 } }).providers[0].gauges[0]).toMatchObject({ used: 7, limit: 1000, source: 'provider' });
    const fallback = buildUsageReport(base).providers[0];
    expect(fallback.gauges[0]).toMatchObject({ used: 5, limit: 50, source: 'log' });
    expect(fallback.analysesLeft).toBe(22);
  });
});
