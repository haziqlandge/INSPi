import { describe, expect, it } from 'vitest';
import { forecast, hourlyBuckets, summaryLine } from '@/lib/client/usage-views';

const HOUR = 3_600_000;
const now = Date.parse('2026-10-05T14:20:00Z');

describe('the Day view', () => {
  it('puts the last 24 hours into clock hours, oldest first, ending with the hour now', () => {
    const buckets = hourlyBuckets([{ at: now - 10 * 60_000, value: 5 }, { at: now - 2 * HOUR, value: 7 }, { at: now - 25 * HOUR, value: 99 }], now);
    expect(buckets).toHaveLength(24);
    expect(buckets[23]).toEqual({ start: Date.parse('2026-10-05T14:00:00Z'), value: 5 });
    expect(buckets[21].value).toBe(7);
    expect(buckets.reduce((s, b) => s + b.value, 0)).toBe(12);
  });
});

describe('the summary line', () => {
  it('says how much is used, the pace, and whether it lasts', () => {
    const f = forecast({ used: 15_000, limit: 200_000, unit: 'tokens', window: 'rolling' }, now);
    expect(f.pace).toBeCloseTo(625, 0);
    const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}K` : String(Math.round(n)));
    expect(summaryLine(f, fmt)).toBe('15K of 200K tokens used · 625 an hour · lasts the day');
  });

  it('names the time it runs out when the pace will not last (a window that resets at midnight UTC)', () => {
    // 150K by 14:20 UTC is about 10.5K an hour: the last 50K go by about 19:07
    const f = forecast({ used: 150_000, limit: 200_000, unit: 'tokens', window: 'utc' }, now);
    expect(f.runsOutAt).not.toBeNull();
    expect(summaryLine(f, String)).toMatch(/runs out at /);
  });

  it('has no limit to measure against for some providers', () => {
    const f = forecast({ used: 4000, limit: null, unit: 'tokens', window: 'rolling' }, now);
    expect(summaryLine(f, String)).toBe('4000 tokens used in the last 24 hours · 167 an hour');
  });
});
