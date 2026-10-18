// The Usage card's arithmetic (components/usage/in-use-views.tsx), as plain functions tested without a browser.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

/** The last 24 clock hours, oldest first; the last is the hour now, still filling. */
export function hourlyBuckets(points: { at: number; value: number }[], now: number): { start: number; value: number }[] {
  const current = Math.floor(now / HOUR) * HOUR;
  const buckets = Array.from({ length: 24 }, (_, i) => ({ start: current - (23 - i) * HOUR, value: 0 }));
  for (const p of points) {
    const i = 23 - Math.floor((current - Math.floor(p.at / HOUR) * HOUR) / HOUR);
    if (i >= 0 && i < 24) buckets[i].value += p.value;
  }
  return buckets;
}

export interface Allowance {
  used: number;
  limit: number | null;
  unit: 'tokens' | 'requests' | 'pollen';
  /** `utc` resets at midnight UTC; `rolling` counts the last 24 hours. */
  window: 'utc' | 'rolling';
}

export interface Forecast extends Allowance {
  /** Per hour, over the window so far. */
  pace: number;
  left: number | null;
  /** When the allowance runs out at this pace, or null when it lasts. */
  runsOutAt: number | null;
}

/**
 * Where today's pace leads. A window that resets at midnight runs out when what is left will not
 * last until then; a rolling 24-hour window refills as old requests roll off, so it runs out only
 * when the pace alone is more than a day's allowance.
 */
export function forecast(a: Allowance, now: number): Forecast {
  const start = a.window === 'utc' ? Math.floor(now / DAY) * DAY : now - DAY;
  const pace = a.used / Math.max(0.25, (now - start) / HOUR);
  const left = a.limit === null ? null : Math.max(0, a.limit - a.used);
  let runsOutAt: number | null = null;
  if (left !== null && pace > 0) {
    const at = now + (left / pace) * HOUR;
    const lasts = a.window === 'utc' ? at >= start + DAY : pace * 24 <= a.limit!;
    runsOutAt = lasts ? null : at;
  }
  return { ...a, pace, left, runsOutAt };
}

const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

/** One line in place of three stat boxes: "15K of 200K tokens used · 625 an hour · lasts the day". */
export function summaryLine(f: Forecast, fmt: (n: number) => string): string {
  const unit = f.unit === 'pollen' ? 'Pollen' : f.unit;
  const pace = `${fmt(f.unit === 'pollen' ? f.pace : Math.round(f.pace))} an hour`;
  if (f.limit === null) return `${fmt(f.used)} ${unit} used ${f.window === 'utc' ? 'since midnight UTC' : 'in the last 24 hours'} · ${pace}`;
  const fate = f.runsOutAt ? `runs out at ${clock(f.runsOutAt)}` : f.window === 'utc' ? 'lasts until midnight UTC' : 'lasts the day';
  return `${fmt(f.used)} of ${fmt(f.limit)} ${unit} used · ${pace} · ${fate}`;
}
