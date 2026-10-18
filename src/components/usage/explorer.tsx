'use client';

import { pollenLabel } from '@/lib/ai/pollen';
import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import type { CallsPage } from '@/app/api/usage/calls/route';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/icons';
import { Segmented } from '@/components/ui/segmented';
import { api, LIBRARY_CHANGED } from '@/lib/client/api';
import type { RecentCall } from '@/lib/store/library';
import { DayChart } from './day-chart';

type Step = 'all' | RecentCall['step'];
type Result = 'all' | 'ok' | 'refused';
type Days = '1' | '7' | '14' | '30';

interface Filters {
  provider: string;
  model: string;
  step: Step;
  result: Result;
  days: Days;
}

const EMPTY: Filters = { provider: '', model: '', step: 'all', result: 'all', days: '14' };
const STEP_LABEL: Record<RecentCall['step'], string> = { observe: 'Reading', translate: 'Writing', imagine: 'Image' };
const ERRORS: Record<string, string> = {
  rate_limit: 'Rate limited',
  too_large: 'Too large',
  auth: 'Key refused',
  bad_request: 'Bad request',
  server: 'Server error',
  network: 'No connection',
  truncated: 'Cut off',
  invalid_output: 'Unreadable answer',
  no_pollen: 'Out of Pollen',
  not_image: 'No image',
  internal: 'Failed here',
};
/** "server:503" (image requests keep the status since 5 Oct) reads as "Server error 503". */
const errorLabel = (error: string | null | undefined) => {
  const [kind, status] = (error ?? '').split(':');
  return ERRORS[kind] ? `${ERRORS[kind]}${status ? ` ${status}` : ''}` : 'Refused';
};
const shortModel = (id: string) => id.split('/').pop() ?? id;
const when = (ms: number) =>
  new Date(ms).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });

/**
 * Every request INSPi has made, narrowed by any mix of constraints: a provider with or without a
 * model, a model alone, the kind of work, the result, the range. Quick lenses set common mixes.
 * Clicking a provider or model in the table narrows to it.
 */
export function Explorer({ inUse, labels }: { inUse: string | null; labels: Record<string, string> }) {
  const [filters, setFilters] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CallsPage | null>(null);
  const [error, setError] = useState<string | null>(null);

  const query = useMemo(() => {
    const q = new URLSearchParams({ days: filters.days, page: String(page), tz: String(-new Date().getTimezoneOffset()) });
    if (filters.provider) q.set('provider', filters.provider);
    if (filters.model) q.set('model', filters.model);
    if (filters.step !== 'all') q.set('step', filters.step);
    if (filters.result !== 'all') q.set('result', filters.result);
    return q.toString();
  }, [filters, page]);

  useEffect(() => {
    let cancelled = false;
    const load = () =>
      api<CallsPage>(`/api/usage/calls?${query}`)
        .then((d) => !cancelled && (setData(d), setError(null)))
        .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : 'Could not load requests.'));
    void load();
    window.addEventListener(LIBRARY_CHANGED, load);
    return () => {
      cancelled = true;
      window.removeEventListener(LIBRARY_CHANGED, load);
    };
  }, [query]);

  function set(patch: Partial<Filters>) {
    setFilters((f) => ({ ...f, ...patch }));
    setPage(1);
  }

  const facets = data?.facets ?? [];
  const providers = [...new Set(facets.map((f) => f.provider))];
  // With a provider chosen, only its models; with none, every model (choosing one needs no provider).
  const models = facets.filter((f) => !filters.provider || f.provider === filters.provider);
  const active = JSON.stringify(filters) !== JSON.stringify(EMPTY);

  const lenses: { label: string; filters: Filters; show: boolean }[] = [
    { label: 'Everything', filters: EMPTY, show: true },
    { label: 'What failed', filters: { ...EMPTY, result: 'refused' }, show: true },
    { label: 'Image generations', filters: { ...EMPTY, step: 'imagine' }, show: true },
    { label: 'Last 24 hours', filters: { ...EMPTY, days: '1' }, show: true },
    { label: `${labels[inUse ?? ''] ?? 'Provider'} in use`, filters: { ...EMPTY, provider: inUse ?? '' }, show: Boolean(inUse) },
  ];

  const s = data?.summary;
  const busiest = data?.busiest ?? null;

  return (
    <div>
      {/* The lenses and filters stay in view while the table scrolls under them (wide screens; on a phone they would fill it). */}
      <div className="z-20 bg-paper pb-3 pt-2 lg:sticky lg:top-0">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Quick lenses">
        {lenses
          .filter((l) => l.show)
          .map((lens) => {
            const on = JSON.stringify(lens.filters) === JSON.stringify(filters);
            return (
              <button key={lens.label} type="button" className="chip py-1.5" aria-pressed={on} onClick={() => (setFilters(lens.filters), setPage(1))}>
                {lens.label}
              </button>
            );
          })}
      </div>

      <div className="mt-3 grid gap-3 rounded-2xl border border-line bg-surface p-4 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto_auto_auto]">
        <label className="block min-w-0">
          <span className="mb-1 block text-[0.75rem] font-medium text-muted">Provider</span>
          <select className="field !py-2" value={filters.provider} onChange={(e) => set({ provider: e.target.value, model: '' })}>
            <option value="">Any provider</option>
            {providers.map((p) => (
              <option key={p} value={p}>
                {labels[p] ?? p}
              </option>
            ))}
          </select>
        </label>
        <label className="block min-w-0">
          <span className="mb-1 block text-[0.75rem] font-medium text-muted">Model</span>
          <select className="field !py-2 font-mono !text-[0.8125rem]" value={filters.model} onChange={(e) => set({ model: e.target.value })}>
            <option value="">Any model</option>
            {models.map((f) => (
              <option key={`${f.provider}:${f.model}`} value={f.model}>
                {shortModel(f.model)} ({f.count})
              </option>
            ))}
          </select>
        </label>
        <div>
          <span className="mb-1 block text-[0.75rem] font-medium text-muted">Work</span>
          <Segmented<Step>
            label="Kind of work"
            size="sm"
            value={filters.step}
            onChange={(step) => set({ step })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'observe', label: 'Read' },
              { value: 'translate', label: 'Write' },
              { value: 'imagine', label: 'Image' },
            ]}
          />
        </div>
        <div>
          <span className="mb-1 block text-[0.75rem] font-medium text-muted">Result</span>
          <Segmented<Result>
            label="Result"
            size="sm"
            value={filters.result}
            onChange={(result) => set({ result })}
            options={[
              { value: 'all', label: 'All' },
              { value: 'ok', label: 'Answered' },
              { value: 'refused', label: 'Refused' },
            ]}
          />
        </div>
        <div>
          <span className="mb-1 block text-[0.75rem] font-medium text-muted">Range</span>
          <Segmented<Days>
            label="Range"
            size="sm"
            value={filters.days}
            onChange={(days) => set({ days })}
            options={[
              { value: '1', label: '24h' },
              { value: '7', label: '7d' },
              { value: '14', label: '14d' },
              { value: '30', label: '30d' },
            ]}
          />
        </div>
      </div>
      {active && (
        <button type="button" className="mt-2 text-[0.8125rem] text-ink underline decoration-accent underline-offset-4" onClick={() => set(EMPTY)}>
          Clear every constraint
        </button>
      )}
      </div>
      {error && <p className="mt-4 text-danger">{error}</p>}

      {s && (
        <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Tile label="Requests" value={s.requests.toLocaleString('en')} />
          <Tile label="Refused" value={s.requests ? `${Math.round((s.refused / s.requests) * 100)}%` : '–'} note={`${s.refused} of ${s.requests}`} />
          <Tile label="Tokens in / out" value={`${compact(s.tokensIn)} / ${compact(s.tokensOut)}`} />
          <Tile label="Busiest model" value={busiest ? shortModel(busiest.model) : '–'} note={busiest ? `${busiest.count} requests` : undefined} />
        </div>
      )}

      {data && data.series.length > 1 && (
        <div className="mt-6">
          <DayChart days={data.series} />
        </div>
      )}

      {data && (
        <div className="mt-6">
          {data.items.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-line px-5 py-10 text-center text-muted">Nothing matches these constraints.</p>
          ) : (
            <div className="overflow-x-auto rounded-2xl border border-line">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="border-b border-line text-xs text-muted">
                  <tr>
                    <th className="px-4 py-3 font-medium">When</th>
                    <th className="px-4 py-3 font-medium">Entry</th>
                    <th className="px-4 py-3 font-medium">Work</th>
                    <th className="px-4 py-3 font-medium">Provider · model</th>
                    <th className="px-4 py-3 text-right font-medium">Tokens or Pollen</th>
                    <th className="px-4 py-3 font-medium">Result</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line/70">
                  {data.items.map((c, i) => (
                    <tr key={`${c.at}-${i}`} className={c.ok ? 'text-ink' : 'text-muted'}>
                      <td className="whitespace-nowrap px-4 py-2.5 tabular-nums">{when(c.at)}</td>
                      <td className="max-w-[12rem] truncate px-4 py-2.5">
                        {c.entrySlug ? (
                          <Link href={`/e/${c.entrySlug}`} className="hover:text-head hover:underline">
                            {c.entryName}
                          </Link>
                        ) : (
                          <span className="text-muted">{c.step === 'imagine' ? 'Playground' : 'Deleted entry'}</span>
                        )}
                      </td>
                      <td className="px-4 py-2.5">{STEP_LABEL[c.step]}</td>
                      <td className="px-4 py-2.5">
                        <button type="button" className="hover:text-head hover:underline" title="Only this provider" onClick={() => set({ provider: c.provider, model: '' })}>
                          {labels[c.provider] ?? c.provider}
                        </button>
                        <span className="text-muted"> · </span>
                        <button type="button" className="font-mono text-xs hover:text-head hover:underline" title="Only this model" onClick={() => set({ model: c.model })}>
                          {shortModel(c.model)}
                        </button>
                      </td>
                      <td className="whitespace-nowrap px-4 py-2.5 text-right tabular-nums">{c.ok ? (pollenLabel(c) ?? (c.tokensIn + c.tokensOut).toLocaleString('en')) : '–'}</td>
                      <td className={`whitespace-nowrap px-4 py-2.5 ${c.ok ? '' : 'text-danger'}`}>{c.ok ? 'Answered' : errorLabel(c.error)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data.pages > 1 && (
            <div className="mt-3 flex items-center justify-end gap-1 text-[0.8125rem] tabular-nums text-muted">
              <button type="button" className="icon-btn h-8 w-8" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Newer requests">
                <ChevronLeftIcon size={16} />
              </button>
              <span>
                Page {page} of {data.pages} · {data.total} requests
              </span>
              <button type="button" className="icon-btn h-8 w-8" disabled={page >= data.pages} onClick={() => setPage((p) => p + 1)} aria-label="Older requests">
                <ChevronRightIcon size={16} />
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function compact(n: number): string {
  return n >= 10_000 ? `${Math.round(n / 1000)}K` : n >= 1000 ? `${(n / 1000).toFixed(1)}K` : String(n);
}

function Tile({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="min-w-0 rounded-2xl border border-line p-4">
      <p className="text-[0.75rem] text-muted">{label}</p>
      <p className="mt-1 truncate text-[1.375rem] font-semibold tabular-nums text-head">{value}</p>
      {note && <p className="truncate text-[0.75rem] text-muted">{note}</p>}
    </div>
  );
}
