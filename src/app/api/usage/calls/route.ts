import type { NextRequest } from 'next/server';
import { syncPollen } from '@/lib/ai/pollen';
import { providerRuntime } from '@/lib/ai/registry';
import { daySeries } from '@/lib/ai/usage';
import { ok } from '@/lib/http';
import { library } from '@/lib/store';
import type { CallRecord, CallSummary, RecentCall } from '@/lib/store/library';

const DAY_MS = 86_400_000;
const PAGE = 10;
const RANGES = [1, 7, 14, 30];
const STEPS: CallRecord['step'][] = ['observe', 'translate', 'imagine'];
/** Enough for a day or two of requests, which is what the in-use card's views draw. */
const MAX_ALL = 500;

export interface CallsPage {
  items: RecentCall[];
  total: number;
  page: number;
  pages: number;
  summary: CallSummary;
  /** Per day over the range, with the same constraints. */
  series: { day: string; tokensIn: number; tokensOut: number; requests: number; refused: number }[];
  /** Every provider and model seen in the range, for the filter menus. */
  facets: { provider: string; model: string; count: number }[];
  /** The model with the most requests among those that matched. */
  busiest: { model: string; count: number } | null;
}

function busiestModel(calls: RecentCall[]): CallsPage['busiest'] {
  const counts = new Map<string, number>();
  for (const c of calls) counts.set(c.model, (counts.get(c.model) ?? 0) + 1);
  const top = [...counts].sort((a, b) => b[1] - a[1])[0];
  return top ? { model: top[0], count: top[1] } : null;
}

/**
 * Requests with any mix of constraints: `provider`, `model`, `step`, `result` (ok|refused), `days`
 * (1, 7, 14 or 30), `page` (10 a page), `tz` (minutes east of UTC). `all=1` returns up to 500 rows.
 */
export async function GET(request: NextRequest) {
  const q = request.nextUrl.searchParams;
  const now = Date.now();
  const pollinations = providerRuntime('pollinations');
  if (pollinations) await syncPollen(library(), { key: pollinations.apiKey });
  const days = RANGES.includes(Number(q.get('days'))) ? Number(q.get('days')) : 14;
  const tz = Number(q.get('tz'));
  const offsetMs = Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz * 60_000 : 0;
  // A 1-day range is the last 24 hours; longer ones start at midnight so the chart's days are whole.
  const since = days === 1 ? now - DAY_MS : Math.floor((now + offsetMs) / DAY_MS) * DAY_MS - offsetMs - (days - 1) * DAY_MS;
  const step = STEPS.find((s) => s === q.get('step'));
  const result = q.get('result');
  const filter = {
    since,
    provider: q.get('provider') || undefined,
    model: q.get('model') || undefined,
    step,
    ok: result === 'ok' ? true : result === 'refused' ? false : undefined,
  };
  const lib = library();
  const all = q.get('all') === '1';
  const page = Math.max(1, Math.floor(Number(q.get('page')) || 1));
  const { items, total, summary } = lib.queryCalls({ ...filter, limit: all ? MAX_ALL : PAGE, offset: all ? 0 : (page - 1) * PAGE });
  const everything = all ? items : lib.queryCalls({ ...filter, limit: 5000, offset: 0 }).items;
  const body: CallsPage = {
    items,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / PAGE)),
    summary,
    series: daySeries(everything, days, now, offsetMs),
    facets: lib.callFacets(since),
    busiest: busiestModel(everything),
  };
  return ok(body);
}
