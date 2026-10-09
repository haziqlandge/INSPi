import type { RecentCall, Usage } from '../store/library';
import type { ProviderId } from './client';
import type { ProviderStatus } from './status';

/** Daily allowances on the free tiers, as far as the providers publish them. */
export const DAILY_LIMITS: Partial<Record<ProviderId, { tokensPerModel?: number; requests?: number; window: 'rolling' | 'utc' }>> = {
  groq: { tokensPerModel: 200_000, window: 'rolling' },
  openrouter: { requests: 50, window: 'utc' },
};

export interface Gauge {
  label: string;
  used: number;
  /** Null when the provider does not publish a daily limit. */
  limit: number | null;
  unit: 'tokens' | 'requests' | 'pollen';
  /** 'provider' when the provider reported the number itself; 'log' when it is counted from INSPi's own calls. */
  source: 'provider' | 'log';
  window: 'rolling' | 'utc';
}

export interface ProviderUsage {
  id: ProviderId;
  label: string;
  hasKey: boolean;
  inUse: boolean;
  gauges: Gauge[];
  /** From the last response's rate-limit headers: what is left of the current minute. */
  minute: { remainingTokens: number | null; limitTokens: number | null; resetsInMs: number | null; at: number } | null;
  /** Rough number of analyses the smallest remaining allowance still covers. */
  analysesLeft: number | null;
  /** Pollinations only: its Pollen balance (null when it could not be read) and the Pollen spent in the last 24 hours. */
  pollen?: PollenUse | null;
}

export interface PollenUse {
  balance: number | null;
  tier: number | null;
  paid: number | null;
  spent24h: number;
}

export interface UsageReport {
  providers: ProviderUsage[];
  days: Usage['days'];
  recent: RecentCall[];
}

export interface UsageInputs {
  now: number;
  usage: Usage;
  recent: RecentCall[];
  statuses: ProviderStatus[];
  /** Average tokens one analysis spent per provider and model, from recent history. */
  cost: (provider: ProviderId, model: string) => number | null;
  /** OpenRouter's own count of free-model requests today, when it could be fetched. */
  openrouterFree?: { used: number; limit: number } | null;
  /** Pollinations' balance and what INSPi spent there in the last 24 hours. */
  pollen?: PollenUse | null;
}

function modelUse(usage: Usage, provider: string, model: string) {
  return usage.models.find((m) => m.provider === provider && m.model === model);
}

export function buildUsageReport(input: UsageInputs): UsageReport {
  const providers = input.statuses.map((status, index): ProviderUsage => {
    const limits = DAILY_LIMITS[status.id];
    const gauges: Gauge[] = [];
    let analysesLeft: number | null = null;
    const models = [...new Set([status.visionModel, status.textModel].filter(Boolean))];

    if (limits?.tokensPerModel) {
      for (const model of models) {
        const used = modelUse(input.usage, status.id, model)?.last24h.tokens ?? 0;
        gauges.push({ label: model, used, limit: limits.tokensPerModel, unit: 'tokens', source: 'log', window: limits.window });
        const cost = input.cost(status.id, model);
        if (cost && cost > 0) {
          const left = Math.max(0, Math.floor((limits.tokensPerModel - used) / cost));
          analysesLeft = analysesLeft === null ? left : Math.min(analysesLeft, left);
        }
      }
    } else if (limits?.requests) {
      const fromProvider = status.id === 'openrouter' ? input.openrouterFree : null;
      const used = fromProvider?.used ?? input.usage.models.filter((m) => m.provider === status.id).reduce((sum, m) => sum + m.utcToday.requests + m.utcToday.refused, 0);
      const limit = fromProvider?.limit ?? limits.requests;
      gauges.push({ label: 'Free requests today', used, limit, unit: 'requests', source: fromProvider ? 'provider' : 'log', window: 'utc' });
      const perAnalysis = input.cost(status.id, '*requests');
      if (perAnalysis && perAnalysis > 0) analysesLeft = Math.max(0, Math.floor((limit - used) / perAnalysis));
    } else if (status.id === 'pollinations' && input.pollen) {
      // Pollen, not tokens: what is left now against what there was a day ago
      const { balance, spent24h } = input.pollen;
      const limit = balance === null ? null : Math.round((balance + spent24h) * 10_000) / 10_000;
      gauges.push({ label: 'Pollen', used: spent24h, limit, unit: 'pollen', source: balance === null ? 'log' : 'provider', window: 'rolling' });
    } else {
      const used = input.usage.models.filter((m) => m.provider === status.id).reduce((sum, m) => sum + m.last24h.tokens, 0);
      if (used > 0 || status.hasKey) gauges.push({ label: 'Tokens, last 24 hours', used, limit: null, unit: 'tokens', source: 'log', window: 'rolling' });
    }

    const rate = status.rate;
    const minute = rate
      ? {
          remainingTokens: rate.remainingTokens ?? null,
          limitTokens: rate.limitTokens ?? null,
          resetsInMs: rate.resetTokensMs != null ? Math.max(0, rate.at + rate.resetTokensMs - input.now) : null,
          at: rate.at,
        }
      : null;

    const pollen = status.id === 'pollinations' ? (input.pollen ?? null) : undefined;
    return { id: status.id, label: status.label, hasKey: status.hasKey, inUse: index === 0, gauges, minute, analysesLeft, ...(pollen !== undefined ? { pollen } : {}) };
  });

  return { providers, days: input.usage.days, recent: input.recent };
}

/** Requests per calendar day in the viewer's time zone (`offsetMs` east of UTC), oldest first. */
export function daySeries(
  calls: { at: number; ok: boolean; tokensIn: number; tokensOut: number }[],
  days: number,
  now: number,
  offsetMs: number,
): Usage['days'] {
  const DAY = 86_400_000;
  const today = Math.floor((now + offsetMs) / DAY) * DAY;
  const byDay = new Map<string, Usage['days'][number]>();
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(today - i * DAY).toISOString().slice(0, 10);
    byDay.set(day, { day, tokensIn: 0, tokensOut: 0, requests: 0, refused: 0 });
  }
  for (const c of calls) {
    const bucket = byDay.get(new Date(c.at + offsetMs).toISOString().slice(0, 10));
    if (!bucket) continue;
    bucket.requests += 1;
    bucket.tokensIn += c.tokensIn;
    bucket.tokensOut += c.tokensOut;
    if (!c.ok) bucket.refused += 1;
  }
  return [...byDay.values()];
}
