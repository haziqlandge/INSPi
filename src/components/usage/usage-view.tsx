'use client';

import { Explorer } from './explorer';
import { InUseViews } from './in-use-views';
import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import CountUp from '@/components/bits/CountUp';
import SloshGauge from '@/components/bits/SloshGauge';
import { RevealHeading } from '@/components/motion/reveal-heading';
import { formatPollen } from '@/lib/ai/pollen';
import type { Gauge, ProviderUsage, UsageReport } from '@/lib/ai/usage';
import { api, LIBRARY_CHANGED } from '@/lib/client/api';
import { useCssColor } from '@/lib/client/use-css-color';

const REFRESH_MS = 15_000;

function compact(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`;
  if (n >= 10_000) return `${Math.round(n / 1000)}K`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}K`;
  return String(n);
}

function shortModel(id: string): string {
  return id.split('/').pop() ?? id;
}

function windowText(gauge: Gauge): string {
  return gauge.window === 'utc' ? 'resets at midnight UTC' : 'over the last 24 hours';
}

/** The liquid shows what is left. It starts full and settles to the real level, so the first view sloshes. */
function LiquidGauge({ gauge, size = 'large' }: { gauge: Gauge; size?: 'large' | 'small' }) {
  const liquid = useCssColor('--accent', '#7f520a');
  const glass = useCssColor('--bg', '#efe4cb');
  const left = gauge.limit ? Math.max(0, Math.min(100, Math.round(100 - (gauge.used / gauge.limit) * 100))) : 100;
  const [level, setLevel] = useState(100);
  useEffect(() => {
    const timer = window.setTimeout(() => setLevel(left), 120);
    return () => window.clearTimeout(timer);
  }, [left]);

  const big = size === 'large';
  return (
    <div className={`flex items-end gap-4 ${big ? '' : 'gap-3'}`}>
      <SloshGauge
        value={level}
        liquidColor={liquid}
        glassColor={glass}
        width={big ? 84 : 44}
        height={big ? 168 : 88}
        radius={big ? 18 : 10}
        ticks={4}
        showValue={big}
        ariaLabel={`${gauge.label}: ${left}% left`}
        className="border border-line text-head shadow-print"
      />
      <div className="min-w-0 pb-1">
        <p className={`${big ? 'display text-[1.375rem] leading-tight' : 'text-sm font-medium text-head'}`}>{gauge.label.includes('/') ? shortModel(gauge.label) : gauge.label}</p>
        {gauge.unit === 'pollen' ? (
          <p className="mt-1 text-sm text-muted">
            {gauge.limit !== null && (
              <>
                <span className="tabular-nums text-ink">{formatPollen(Math.max(0, gauge.limit - gauge.used))}</span> Pollen left;{' '}
              </>
            )}
            <span className="tabular-nums text-ink">{formatPollen(gauge.used)}</span> spent over the last 24 hours
            {gauge.limit === null && '. The balance could not be read.'}
          </p>
        ) : gauge.limit ? (
          <p className="mt-1 text-sm text-muted">
            <span className="tabular-nums text-ink">{compact(Math.max(0, gauge.limit - gauge.used))}</span> of {compact(gauge.limit)} {gauge.unit} left, {windowText(gauge)}
          </p>
        ) : (
          <p className="mt-1 text-sm text-muted">
            <span className="tabular-nums text-ink">{compact(gauge.used)}</span> {gauge.unit} used {windowText(gauge)}. No published daily limit.
          </p>
        )}
        <p className="mt-0.5 text-xs text-muted/90">{gauge.source === 'provider' ? 'As reported by the provider.' : 'Counted from INSPi’s own requests.'}</p>
      </div>
    </div>
  );
}

function Minute({ provider }: { provider: ProviderUsage }) {
  const minute = provider.minute;
  if (!minute || minute.remainingTokens == null || !minute.limitTokens) return null;
  const share = Math.max(0, Math.min(1, minute.remainingTokens / minute.limitTokens));
  return (
    <div className="mt-6 max-w-md">
      <div className="flex items-baseline justify-between text-[0.8125rem] text-muted">
        <span>This minute, at the last request</span>
        <span className="tabular-nums text-ink">
          {minute.remainingTokens.toLocaleString('en')} of {minute.limitTokens.toLocaleString('en')} tokens
        </span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-line" role="presentation">
        <div className="h-full rounded-full bg-accent transition-[width] duration-700" style={{ width: `${share * 100}%` }} />
      </div>
    </div>
  );
}

export function UsageView() {
  const [report, setReport] = useState<UsageReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReport(await api<UsageReport>(`/api/usage?tz=${-new Date().getTimezoneOffset()}`));
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Usage could not be loaded.');
    }
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(load, REFRESH_MS);
    window.addEventListener(LIBRARY_CHANGED, load);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener(LIBRARY_CHANGED, load);
    };
  }, [load]);

  const inUse = report?.providers.find((p) => p.inUse);
  const others = report?.providers.filter((p) => !p.inUse && p.hasKey) ?? [];

  return (
    <div className="px-4 pt-4 sm:px-8">
      <h1 className="display text-[clamp(2.5rem,5vw,4rem)] leading-none">Usage</h1>
      <p className="mt-3 max-w-[40rem] text-[1.0625rem] leading-relaxed text-muted">
        How much the free AI tiers have left today. Where a provider does not say, INSPi counts its own requests.
      </p>
      {error && <p className="mt-6 text-danger">{error}</p>}

      {inUse && (
        <section className="mt-10 rounded-[1.25rem] border border-line bg-surface p-5 shadow-print sm:p-8" aria-label={`${inUse.label}, in use`}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
            <h2 className="display text-[1.75rem] leading-tight">
              {inUse.label} <span className="badge ml-2 align-middle">in use</span>
            </h2>
            {inUse.analysesLeft !== null && (
              <p className="text-[0.9375rem] text-ink">
                About{' '}
                <CountUp to={inUse.analysesLeft} duration={1.1} className="display text-[2.25rem] leading-none tabular-nums text-accent" />{' '}
                more {inUse.analysesLeft === 1 ? 'analysis' : 'analyses'} today
              </p>
            )}
          </div>
          {/* Gauges on the left; the right side was empty, so it holds a view the viewer picks. */}
          <div className="mt-7 grid gap-8 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:gap-12">
            <div>
              {inUse.gauges.length ? (
                <div className="space-y-6">
                  {inUse.gauges.map((gauge, i) => (
                    <div key={gauge.label}>
                      {inUse.gauges.length > 1 && <p className="mb-3 text-xs font-medium text-muted">{i === 0 ? 'Reading images' : 'Writing prompts'}</p>}
                      <LiquidGauge gauge={gauge} />
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-muted">Nothing has been sent to {inUse.label} yet.</p>
              )}
              <Minute provider={inUse} />
            </div>
            <InUseViews provider={inUse} />
          </div>
          <p className="mt-6 text-[0.8125rem] text-muted">
            Switch providers from the dock or in <Link href="/settings" className="text-ink underline decoration-accent underline-offset-4">Settings</Link>.
          </p>
        </section>
      )}

      {others.length > 0 && (
        <section className="mt-6" aria-label="Other providers">
          <p className="mb-2 text-[0.8125rem] text-muted">Other providers with a key</p>
          {/* A grid, not a strip that scrolls sideways */}
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {others.map((provider) => (
              <li key={provider.id} className="rounded-2xl border border-line p-4">
                <p className="display text-[1.125rem] leading-tight">{provider.label}</p>
                <div className="mt-3 space-y-3">
                  {provider.gauges.length ? (
                    provider.gauges.slice(0, 2).map((gauge) => <LiquidGauge key={gauge.label} gauge={gauge} size="small" />)
                  ) : (
                    <p className="text-sm text-muted">Not used yet.</p>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {report && (
        <section className="mt-16" aria-labelledby="explore-heading">
          <RevealHeading id="explore-heading" className="display text-[clamp(1.75rem,3.5vw,2.5rem)] leading-none">
            Explore requests
          </RevealHeading>
          <p className="mt-2 max-w-[40rem] text-muted">
            Narrow by provider, model, either or both, then by kind of work, result and range. Click a provider or model in the table to narrow to it.
          </p>
          <div className="mt-5">
            <Explorer inUse={inUse?.id ?? null} labels={Object.fromEntries(report.providers.map((p) => [p.id, p.label]))} />
          </div>
        </section>
      )}
    </div>
  );
}
