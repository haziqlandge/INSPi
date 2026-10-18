'use client';

import { useEffect, useState } from 'react';
import type { CallsPage } from '@/app/api/usage/calls/route';
import { Segmented } from '@/components/ui/segmented';
import { formatPollen, pollenLabel, pollenSpent } from '@/lib/ai/pollen';
import type { ProviderUsage } from '@/lib/ai/usage';
import { api } from '@/lib/client/api';
import { forecast, hourlyBuckets, summaryLine } from '@/lib/client/usage-views';
import type { RecentCall } from '@/lib/store/library';

type View = 'day' | 'week' | 'mix';
type Unit = 'tokens' | 'requests' | 'pollen';
type WeekDay = CallsPage['series'][number];

const VIEW_KEY = 'inspi:usage-card-view';
/** Views saved before 5 Oct 2026: Forecast became Week, Timeline became Day. */
const SAVED: Record<string, View> = { day: 'day', week: 'week', mix: 'mix', forecast: 'week', timeline: 'day' };
const TITLE: Record<View, string> = { day: 'Last 24 hours', week: 'Last 7 days', mix: 'Where it went' };
const STEP_LABEL: Record<RecentCall['step'], string> = { observe: 'Reading', translate: 'Writing', imagine: 'Images' };
const shortModel = (id: string) => id.split('/').pop()?.replace(/:free$/, '') ?? id;
const clock = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
const hourOf = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric' });
const weekday = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d).toLocaleDateString([], { weekday: 'short' });
};

/**
 * The provider in use: beside its gauges, one panel with a title, a one-line summary and the view
 * the viewer picks (the last 24 hours by the hour, the week by the day, or where it went). All text
 * is the page's own; nothing is an SVG scaled to the card.
 */
export function InUseViews({ provider }: { provider: ProviderUsage }) {
  const [view, setView] = useState<View>('day');
  const [calls, setCalls] = useState<RecentCall[] | null>(null);
  const [week, setWeek] = useState<WeekDay[] | null>(null);

  useEffect(() => {
    try {
      const saved = SAVED[localStorage.getItem(VIEW_KEY) ?? ''];
      if (saved) setView(saved);
    } catch {
      // storage blocked: keep the default
    }
  }, []);

  useEffect(() => {
    const tz = -new Date().getTimezoneOffset();
    api<CallsPage>(`/api/usage/calls?provider=${provider.id}&days=1&all=1&tz=${tz}`)
      .then((page) => setCalls(page.items))
      .catch(() => setCalls([]));
    api<CallsPage>(`/api/usage/calls?provider=${provider.id}&days=7&tz=${tz}`)
      .then((page) => setWeek(page.series))
      .catch(() => setWeek([]));
  }, [provider.id]);

  function choose(next: View) {
    setView(next);
    try {
      localStorage.setItem(VIEW_KEY, next);
    } catch {
      // fine: the choice just is not remembered
    }
  }

  const gauge = provider.gauges[0];
  const unit: Unit = gauge?.unit ?? 'tokens';
  const fmt = (n: number) =>
    unit === 'pollen' ? formatPollen(n) : unit === 'tokens' && n >= 1000 ? `${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}K` : Math.round(n).toLocaleString('en');
  const amount = (c: RecentCall) => (unit === 'requests' ? 1 : unit === 'pollen' ? pollenSpent([c]) : c.tokensIn + c.tokensOut);
  const f = gauge ? forecast({ used: gauge.used, limit: gauge.limit, unit, window: gauge.window }, Date.now()) : null;

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2">
        <h3 className="display text-[1.375rem] leading-tight">{TITLE[view]}</h3>
        <Segmented<View>
          label="What to show beside the gauges"
          size="sm"
          value={view}
          onChange={choose}
          options={[
            { value: 'day', label: 'Day' },
            { value: 'week', label: 'Week' },
            { value: 'mix', label: 'Mix' },
          ]}
        />
      </div>
      {f && <p className="mt-1 text-sm text-muted">{summaryLine(f, fmt)}</p>}
      {/* One height for every view, so switching never resizes the card */}
      <div className="mt-6 min-h-[22.75rem]">
        {calls === null ? (
          <p className="text-sm text-muted">Reading the last day…</p>
        ) : view === 'day' ? (
          <Day calls={calls} amount={amount} fmt={fmt} unit={unit} limit={gauge?.limit ?? null} label={provider.label} />
        ) : view === 'week' ? (
          week === null ? (
            <p className="text-sm text-muted">Reading the week…</p>
          ) : (
            <Week series={week} unit={unit} fmt={fmt} limit={unit === 'requests' ? (gauge?.limit ?? null) : null} />
          )
        ) : (
          <Mix calls={calls} />
        )}
      </div>
    </div>
  );
}

interface Bar {
  key: string;
  value: number;
  label: string;
  /** What hovering the bar says. */
  tip: string;
  current: boolean;
}

/** Bars in ordinary HTML: rounded tops on a baseline, a hairline axis, a hover readout above. */
function Bars({ bars, guide, label }: { bars: Bar[]; guide?: { value: number; label: string } | null; label: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const peak = Math.max(1, guide?.value ?? 0, ...bars.map((b) => b.value)) * 1.1;
  return (
    <figure>
      <p className="h-5 truncate text-[0.8125rem] tabular-nums text-ink" aria-live="polite">
        {hover !== null ? bars[hover].tip : ''}
      </p>
      <div className="relative mt-1 h-40 border-b border-line">
        {guide && (
          <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-muted/50" style={{ bottom: `${(guide.value / peak) * 100}%` }}>
            <span className="absolute -top-5 right-0 text-[0.75rem] text-muted">{guide.label}</span>
          </div>
        )}
        <ul className="flex h-full items-end gap-[2px]" aria-label={label}>
          {bars.map((b, i) => (
            <li
              key={b.key}
              className="flex h-full min-w-0 flex-1 items-end"
              title={b.tip}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover(null)}
            >
              <span
                className={`block w-full rounded-t-[4px] bg-chart transition-opacity ${b.current || hover === i ? '' : 'opacity-55'}`}
                style={{ height: b.value > 0 ? `max(3px, ${(b.value / peak) * 100}%)` : 0 }}
              />
            </li>
          ))}
        </ul>
      </div>
      <ul className="mt-1.5 flex gap-[2px] text-[0.75rem] text-muted" aria-hidden>
        {bars.map((b) => (
          <li key={b.key} className={`min-w-0 flex-1 overflow-visible whitespace-nowrap text-center ${b.current ? 'font-medium text-ink' : ''}`}>
            {b.label}
          </li>
        ))}
      </ul>
    </figure>
  );
}

/** The last 24 hours by the clock hour, with the even pace that lasts the day as a rule, then the latest requests. */
function Day({
  calls,
  amount,
  fmt,
  unit,
  limit,
  label,
}: {
  calls: RecentCall[];
  amount: (c: RecentCall) => number;
  fmt: (n: number) => string;
  unit: Unit;
  limit: number | null;
  label: string;
}) {
  if (!calls.length) return <p className="text-sm text-muted">Nothing sent to {label} in the last 24 hours: the whole allowance is waiting.</p>;
  const buckets = hourlyBuckets(
    calls.map((c) => ({ at: c.at, value: amount(c) })),
    Date.now(),
  );
  const counts = hourlyBuckets(
    calls.map((c) => ({ at: c.at, value: 1 })),
    Date.now(),
  );
  const unitText = unit === 'pollen' ? 'Pollen' : unit;
  const bars: Bar[] = buckets.map((b, i) => ({
    key: String(b.start),
    value: b.value,
    label: i === 23 ? 'now' : i % 6 === 5 ? hourOf(b.start) : '',
    tip: `${hourOf(b.start)}: ${fmt(b.value)} ${unitText}, ${counts[i].value} ${counts[i].value === 1 ? 'request' : 'requests'}`,
    current: i === 23,
  }));
  const guide = limit !== null && unit !== 'pollen' ? { value: limit / 24, label: `even pace, ${fmt(limit / 24)} an hour` } : null;
  const latest = [...calls].sort((a, b) => b.at - a.at).slice(0, 4);
  return (
    <>
      <Bars bars={bars} guide={guide} label={`${unitText} per hour, last 24 hours`} />
      <ul className="mt-5 divide-y divide-line/70 text-[0.8125rem]">
        {latest.map((c, i) => (
          <li key={`${c.at}-${i}`} className="flex items-center gap-3 py-1.5">
            <span className="w-[4.5rem] shrink-0 whitespace-nowrap tabular-nums text-muted">{clock(c.at)}</span>
            <span className="w-16 shrink-0 text-muted">{STEP_LABEL[c.step]}</span>
            <span className="min-w-0 flex-1 truncate text-ink">{c.entryName ?? shortModel(c.model)}</span>
            <span className={`shrink-0 tabular-nums ${c.ok ? 'text-muted' : 'text-danger'}`}>
              {c.ok ? (pollenLabel(c) ?? `${(c.tokensIn + c.tokensOut).toLocaleString('en')} tok`) : 'refused'}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}

/** The last seven days, one bar each; a requests allowance shows as a rule. */
function Week({ series, unit, fmt, limit }: { series: WeekDay[]; unit: Unit; fmt: (n: number) => string; limit: number | null }) {
  const value = (d: WeekDay) => (unit === 'requests' ? d.requests : d.tokensIn + d.tokensOut);
  const unitText = unit === 'requests' ? 'requests' : 'tokens';
  const bars: Bar[] = series.map((d, i) => ({
    key: d.day,
    value: value(d),
    label: i === series.length - 1 ? 'Today' : weekday(d.day),
    tip: `${weekday(d.day)}: ${fmt(value(d))} ${unitText}, ${d.requests} requests${d.refused ? `, ${d.refused} refused` : ''}`,
    current: i === series.length - 1,
  }));
  const total = series.reduce((s, d) => s + value(d), 0);
  const busiest = series.reduce((best, d) => (value(d) > value(best) ? d : best), series[0]);
  return (
    <>
      <Bars bars={bars} guide={limit !== null ? { value: limit, label: `allowance, ${fmt(limit)} a day` } : null} label={`${unitText} per day, last 7 days`} />
      {series.length > 0 && (
        <p className="mt-5 text-[0.8125rem] text-muted">
          {fmt(total)} {unitText} this week; the busiest day was {weekday(busiest.day)} with {fmt(value(busiest))}.
        </p>
      )}
    </>
  );
}

/** Where the last day's requests went: by model, by kind of work, and the entries that used the most. */
function Mix({ calls }: { calls: RecentCall[] }) {
  if (!calls.length) return <p className="text-sm text-muted">No requests in the last 24 hours.</p>;
  const byModel = new Map<string, { n: number; refused: number }>();
  const byStep = new Map<RecentCall['step'], number>();
  const byEntry = new Map<string, number>();
  for (const c of calls) {
    const m = byModel.get(c.model) ?? { n: 0, refused: 0 };
    m.n += 1;
    if (!c.ok) m.refused += 1;
    byModel.set(c.model, m);
    byStep.set(c.step, (byStep.get(c.step) ?? 0) + 1);
    if (c.entryName) byEntry.set(c.entryName, (byEntry.get(c.entryName) ?? 0) + c.tokensIn + c.tokensOut);
  }
  const models = [...byModel].sort((a, b) => b[1].n - a[1].n).slice(0, 5);
  const max = Math.max(1, ...models.map(([, m]) => m.n));
  const entries = [...byEntry].sort((a, b) => b[1] - a[1]).slice(0, 3);
  return (
    <div className="grid gap-6 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div>
        <p className="text-[0.75rem] text-muted">Requests by model</p>
        <ul className="mt-2 space-y-2.5">
          {models.map(([model, m]) => (
            <li key={model}>
              <div className="flex items-baseline justify-between gap-3 text-[0.8125rem]">
                <span className="truncate text-ink">{shortModel(model)}</span>
                <span className="shrink-0 tabular-nums text-muted">
                  {m.n}
                  {m.refused ? <span className="text-danger"> · {m.refused} refused</span> : null}
                </span>
              </div>
              <div className="mt-1 h-1.5 rounded-full bg-line/60">
                <div className="h-full rounded-full bg-chart" style={{ width: `${(m.n / max) * 100}%` }} />
              </div>
            </li>
          ))}
        </ul>
      </div>
      <div className="space-y-5">
        <div>
          <p className="text-[0.75rem] text-muted">By kind of work</p>
          <ul className="mt-2 space-y-1 text-[0.8125rem]">
            {[...byStep].map(([step, n]) => (
              <li key={step} className="flex justify-between gap-3">
                <span className="text-ink">{STEP_LABEL[step]}</span>
                <span className="tabular-nums text-muted">{n}</span>
              </li>
            ))}
          </ul>
        </div>
        {entries.length > 0 && (
          <div>
            <p className="text-[0.75rem] text-muted">Entries that used the most</p>
            <ol className="mt-2 space-y-1 text-[0.8125rem]">
              {entries.map(([name, tokens]) => (
                <li key={name} className="flex justify-between gap-3">
                  <span className="truncate text-ink">{name}</span>
                  <span className="shrink-0 tabular-nums text-muted">{tokens.toLocaleString('en')} tok</span>
                </li>
              ))}
            </ol>
          </div>
        )}
      </div>
    </div>
  );
}
