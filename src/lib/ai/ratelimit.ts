export interface RateInfo {
  retryAfterMs?: number;
  limitTokens?: number;
  remainingTokens?: number;
  resetTokensMs?: number;
  limitRequests?: number;
  remainingRequests?: number;
  resetRequestsMs?: number;
}

const UNIT_MS: Record<string, number> = { h: 3_600_000, m: 60_000, s: 1000, ms: 1 };

/** Reads "7.66s", "2m59.56s", "120ms", or a bare number of seconds. */
export function parseDuration(value: string | null | undefined): number | null {
  if (value == null) return null;
  const text = value.trim();
  if (text === '') return null;
  if (/^\d+(\.\d+)?$/.test(text)) return Math.round(Number(text) * 1000);

  let total = 0;
  let matched = 0;
  const pattern = /(\d+(?:\.\d+)?)(ms|h|m|s)/g;
  for (let m = pattern.exec(text); m; m = pattern.exec(text)) {
    total += Number(m[1]) * UNIT_MS[m[2]];
    matched += m[0].length;
  }
  return matched === text.length && matched > 0 ? Math.round(total) : null;
}

function int(headers: Headers, name: string): number | undefined {
  const raw = headers.get(name);
  if (raw == null) return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

function duration(headers: Headers, name: string): number | undefined {
  return parseDuration(headers.get(name)) ?? undefined;
}

/** Groq reports requests per day and tokens per minute; other providers may send none of these. */
export function readRateInfo(headers: Headers): RateInfo {
  const info: RateInfo = {
    retryAfterMs: duration(headers, 'retry-after'),
    limitTokens: int(headers, 'x-ratelimit-limit-tokens'),
    remainingTokens: int(headers, 'x-ratelimit-remaining-tokens'),
    resetTokensMs: duration(headers, 'x-ratelimit-reset-tokens'),
    limitRequests: int(headers, 'x-ratelimit-limit-requests'),
    remainingRequests: int(headers, 'x-ratelimit-remaining-requests'),
    resetRequestsMs: duration(headers, 'x-ratelimit-reset-requests'),
  };
  for (const key of Object.keys(info) as (keyof RateInfo)[]) {
    if (info[key] === undefined) delete info[key];
  }
  return info;
}

const MARGIN_MS = 500;

/** Milliseconds to hold off so the next call of `neededTokens` fits the known allowance. */
export function waitBeforeCall(info: RateInfo | null, neededTokens: number): number {
  if (!info) return 0;
  if (info.remainingRequests === 0 && info.resetRequestsMs != null) return info.resetRequestsMs + MARGIN_MS;
  if (info.remainingTokens != null && info.resetTokensMs != null && info.remainingTokens < neededTokens) {
    return info.resetTokensMs + MARGIN_MS;
  }
  return 0;
}
