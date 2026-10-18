'use client';

import { useEffect, useRef, useState } from 'react';
import type { Usage } from '@/lib/store/library';

const HEIGHT = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 44 };
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function label(day: string): string {
  const [, m, d] = day.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]}`;
}

function short(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

/** A tidy axis maximum: 1, 2 or 5 times a power of ten. */
function niceMax(value: number): number {
  if (value <= 0) return 1000;
  const power = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].find((f) => f * power >= value) ?? 10) * power;
}

/** Bar with a 4px rounded end at the top and a square foot on the baseline. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/** Tokens per day, one bar each; hover or focus a day for the split and the request count. */
export function DayChart({ days }: { days: Usage['days'] }) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(640);
  const [hover, setHover] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(280, entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const totals = days.map((d) => d.tokensIn + d.tokensOut);
  const max = niceMax(Math.max(...totals, 0));
  const plotW = width - PAD.left - PAD.right;
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(1, days.length);
  const barW = Math.max(4, Math.min(34, slot - 2));
  const ticks = [0, max / 2, max];
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const shown = hover !== null ? days[hover] : null;
  const labelEvery = slot < 34 ? 3 : slot < 48 ? 2 : 1;

  return (
    <div ref={box} className="relative mt-6">
      <svg width={width} height={HEIGHT} role="img" aria-label={`Tokens per day for the last ${days.length} days`} className="block overflow-visible">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} strokeDasharray={t === 0 ? undefined : '2 4'} />
            <text x={PAD.left - 8} y={y(t)} dy="0.32em" textAnchor="end" className="fill-muted text-[11px] tabular-nums">
              {short(t)}
            </text>
          </g>
        ))}
        {days.map((day, i) => {
          const total = totals[i];
          const x = PAD.left + i * slot + (slot - barW) / 2;
          const h = total > 0 ? Math.max(2, (total / max) * plotH) : 0;
          return (
            <g
              key={day.day}
              tabIndex={0}
              role="button"
              aria-label={`${label(day.day)}: ${total.toLocaleString('en')} tokens, ${day.requests} requests answered${day.refused ? `, ${day.refused} refused` : ''}`}
              onPointerEnter={() => setHover(i)}
              onPointerLeave={() => setHover((current) => (current === i ? null : current))}
              onFocus={() => setHover(i)}
              onBlur={() => setHover(null)}
              className="cursor-default outline-none"
            >
              {/* The hit area is the whole column, wider and taller than the bar. */}
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={plotH} fill="transparent" />
              {h > 0 && <path d={barPath(x, y(0) - h, barW, h)} fill="var(--chart)" opacity={hover === null || hover === i ? 1 : 0.45} className="transition-opacity" />}
              {i % labelEvery === (days.length - 1) % labelEvery && (
                <text x={x + barW / 2} y={HEIGHT - 8} textAnchor="middle" className={`text-[11px] ${hover === i ? 'fill-head' : 'fill-muted'}`}>
                  {label(day.day)}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {shown && hover !== null && (
        <div
          className="pointer-events-none absolute top-0 z-10 w-max -translate-x-1/2 rounded-xl border border-line bg-surface px-3 py-2 text-[0.8125rem] shadow-lift"
          style={{ left: Math.min(width - 90, Math.max(90, PAD.left + hover * slot + slot / 2)) }}
        >
          <p className="font-medium text-head">{label(shown.day)}</p>
          <p className="tabular-nums text-ink">{(shown.tokensIn + shown.tokensOut).toLocaleString('en')} tokens</p>
          <p className="tabular-nums text-muted">
            {shown.tokensIn.toLocaleString('en')} in, {shown.tokensOut.toLocaleString('en')} out
          </p>
          <p className="tabular-nums text-muted">
            {shown.requests} answered{shown.refused ? `, ${shown.refused} refused` : ''}
          </p>
        </div>
      )}
    </div>
  );
}
