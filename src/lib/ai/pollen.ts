import { MODEL_FACTS } from '../imagine/recommend';
import type { Library, RecentCall } from '../store/library';

/**
 * What Pollinations charged. INSPi logs its own requests, but a Pollinations image costs no tokens,
 * so Usage showed "0 tok". Pollinations keeps a usage log a key may always read
 * (`GET /account/key/usage`, free) with `cost_usd` per request; Pollen is priced at one dollar, so
 * that is the Pollen spent (checked 5 Oct 2026: GPT Image 2 0.0309 against the 0.032 estimated).
 */

const BASE = 'https://gen.pollinations.ai';
const DAY_MS = 86_400_000;
/** An event may have ended up to this long before INSPi logged the call (a slow model, a busy queue). */
const BEFORE_MS = 5 * 60_000;
/** Clocks differ a little: an event may seem to end this long after the call was logged. */
const AFTER_MS = 60_000;

export interface PollenEvent {
  model: string;
  /** Epoch ms when Pollinations took the request. */
  at: number;
  responseMs: number;
  pollen: number;
}

/** Community models are listed with a "community/" prefix that the usage log may leave off. */
const bare = (id: string) => id.replace(/^community\//, '');

/**
 * Pairs each call with the event for the same model that ended nearest to when the call was logged,
 * within BEFORE_MS before and AFTER_MS after; each event pays for one call at most.
 */
export function matchPollen(calls: { id: number; model: string; at: number }[], events: PollenEvent[]): { id: number; pollen: number }[] {
  const used = new Set<number>();
  const out: { id: number; pollen: number }[] = [];
  for (const call of [...calls].sort((a, b) => a.at - b.at)) {
    let best = -1;
    let bestGap = Infinity;
    events.forEach((event, i) => {
      if (used.has(i) || bare(event.model) !== bare(call.model)) return;
      const gap = call.at - (event.at + (event.responseMs || 0));
      if (gap < -AFTER_MS || gap > BEFORE_MS) return;
      if (Math.abs(gap) < bestGap) {
        bestGap = Math.abs(gap);
        best = i;
      }
    });
    if (best >= 0) {
      used.add(best);
      out.push({ id: call.id, pollen: events[best].pollen });
    }
  }
  return out;
}

interface SyncOptions {
  key: string;
  fetchImpl?: typeof fetch;
  now?: number;
  /** Skip the once-a-minute limit (tests). */
  force?: boolean;
}

const state = globalThis as { __inspiPollenSync?: number; __inspiPollenBalance?: { at: number; value: PollenBalance | null } };

/**
 * Fills in the Pollen of the last week's Pollinations calls from Pollinations' own log. At most
 * once a minute; never throws, so Usage still draws (with estimates) when Pollinations is away.
 * Returns how many calls it priced.
 */
export async function syncPollen(lib: Pick<Library, 'unpricedPollinationsCalls' | 'setCallPollen'>, { key, fetchImpl = fetch, now = Date.now(), force = false }: SyncOptions): Promise<number> {
  if (!force && state.__inspiPollenSync && now - state.__inspiPollenSync < 60_000) return 0;
  state.__inspiPollenSync = now;
  try {
    const open = lib.unpricedPollinationsCalls(now - 7 * DAY_MS);
    if (!open.length) return 0;
    const response = await fetchImpl(`${BASE}/account/key/usage?days=7&limit=500`, {
      headers: { authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) return 0;
    const body = (await response.json()) as { usage?: { timestamp?: string; model?: string | null; cost_usd?: number; response_time_ms?: number | null }[] };
    const events: PollenEvent[] = (body.usage ?? []).flatMap((u) =>
      typeof u.model === 'string' && typeof u.cost_usd === 'number' && typeof u.timestamp === 'string'
        ? [{ model: u.model, at: Date.parse(`${u.timestamp.replace(' ', 'T')}Z`), responseMs: u.response_time_ms ?? 0, pollen: u.cost_usd }]
        : [],
    );
    const matches = matchPollen(open, events);
    for (const m of matches) lib.setCallPollen(m.id, m.pollen);
    return matches.length;
  } catch {
    return 0;
  }
}

export interface PollenBalance {
  /** What this key can still spend: Quest Pollen plus paid. */
  balance: number;
  tier: number;
  paid: number;
}

/** The key's Pollen balance (`GET /account/balance`, free), cached for a minute; null when unknown. */
export async function pollenBalance(key: string, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<PollenBalance | null> {
  const cached = state.__inspiPollenBalance;
  if (cached && now - cached.at < 60_000) return cached.value;
  let value: PollenBalance | null = null;
  try {
    const response = await fetchImpl(`${BASE}/account/balance`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(5000) });
    const body = (await response.json()) as { balance?: number; accountBalance?: { tier?: number; paid?: number } };
    if (response.ok && typeof body.balance === 'number') {
      value = { balance: body.balance, tier: body.accountBalance?.tier ?? body.balance, paid: body.accountBalance?.paid ?? 0 };
    }
  } catch {
    value = null;
  }
  state.__inspiPollenBalance = { at: now, value };
  return value;
}

type PricedCall = Pick<RecentCall, 'provider' | 'model' | 'step' | 'ok' | 'pollen'>;

/** Pollen as people read it: two decimals from one Pollen up, three below. */
export function formatPollen(n: number): string {
  if (n === 0) return '0';
  if (n >= 1) return n.toFixed(2);
  if (n >= 0.001) return n.toFixed(3);
  return '<0.001';
}

/** What a call cost: Pollinations' own figure once known, else the model's usual price for an image. */
function pollenOf(call: PricedCall): { value: number; estimate: boolean } | null {
  if (call.provider !== 'pollinations' || !call.ok) return null;
  if (call.pollen !== null) return { value: call.pollen, estimate: false };
  const facts = call.step === 'imagine' ? MODEL_FACTS[call.model] : undefined;
  return facts ? { value: facts.pollen, estimate: true } : null;
}

/** "0.031 Pollen", "≈0.032 Pollen" while estimated, or null where tokens tell the story. */
export function pollenLabel(call: PricedCall): string | null {
  const cost = pollenOf(call);
  return cost ? `${cost.estimate ? '≈' : ''}${formatPollen(cost.value)} Pollen` : null;
}

/** Pollen the calls spent, estimates included. */
export function pollenSpent(calls: PricedCall[]): number {
  return calls.reduce((sum, call) => sum + (pollenOf(call)?.value ?? 0), 0);
}
