import { pollenBalance, pollenSpent, syncPollen } from '@/lib/ai/pollen';
import { providerRuntime } from '@/lib/ai/registry';
import { providerStatuses } from '@/lib/ai/status';
import { buildUsageReport } from '@/lib/ai/usage';
import { ok } from '@/lib/http';
import { readSettings } from '@/lib/settings';
import { library } from '@/lib/store';

const WEEK_MS = 7 * 86_400_000;
const DAY_MS = 86_400_000;
const globals = globalThis as { __inspiOpenRouterFree?: { at: number; value: { used: number; limit: number } | null } };

/** OpenRouter reports its own count of free-model requests today. Costs nothing; cached for a minute. */
async function openrouterFree(): Promise<{ used: number; limit: number } | null> {
  const cached = globals.__inspiOpenRouterFree;
  if (cached && Date.now() - cached.at < 60_000) return cached.value;
  const runtime = providerRuntime('openrouter');
  let value: { used: number; limit: number } | null = null;
  if (runtime) {
    try {
      const response = await fetch(`${runtime.baseUrl}/key`, { headers: { authorization: `Bearer ${runtime.apiKey}` }, signal: AbortSignal.timeout(5000) });
      const body = (await response.json()) as { data?: { free_model_daily_requests?: { used?: number; limit?: number } } };
      const free = body.data?.free_model_daily_requests;
      if (response.ok && typeof free?.used === 'number' && typeof free.limit === 'number') value = { used: free.used, limit: free.limit };
    } catch {
      value = null;
    }
  }
  globals.__inspiOpenRouterFree = { at: Date.now(), value };
  return value;
}

/** Tokens and requests per provider for the Usage page. */
export async function GET(request: Request) {
  const lib = library();
  const now = Date.now();
  // Minutes east of UTC, so the chart's days match the viewer's calendar.
  const tz = Number(new URL(request.url).searchParams.get('tz'));
  const offsetMs = Number.isFinite(tz) && Math.abs(tz) <= 14 * 60 ? tz * 60_000 : 0;
  // Pollinations bills in Pollen: price this week's calls from its own log, and read the balance (both free)
  const pollinations = providerRuntime('pollinations');
  let pollen = null;
  if (pollinations) {
    await syncPollen(lib, { key: pollinations.apiKey });
    const balance = await pollenBalance(pollinations.apiKey);
    pollen = { balance: balance?.balance ?? null, tier: balance?.tier ?? null, paid: balance?.paid ?? null, spent24h: pollenSpent(lib.pollinationsCalls(now - DAY_MS)) };
  }
  const report = buildUsageReport({
    now,
    usage: lib.usage({ now, days: 14, offsetMs }),
    recent: lib.recentCalls(40),
    statuses: providerStatuses(readSettings(lib)),
    cost: (provider, model) => lib.analysisCost(provider, model, now - WEEK_MS),
    openrouterFree: await openrouterFree(),
    pollen,
  });
  return ok(report);
}
