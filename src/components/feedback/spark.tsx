'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, type ReactNode } from 'react';

interface Spark {
  x: number;
  y: number;
  angle: number;
  start: number;
}

type Burst = (x: number, y: number) => void;

const SparkContext = createContext<Burst>(() => {});

const COUNT = 9;
const DURATION = 460;
const SIZE = 9;
const RADIUS = 20;

/**
 * A full-window canvas that throws a small burst of lines from a point. Used when something is
 * copied. The drawing follows React Bits' ClickSpark, made callable from anywhere.
 */
export function SparkProvider({ children }: { children: ReactNode }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const sparks = useRef<Spark[]>([]);
  const frame = useRef(0);

  const draw = useCallback(function tick(now: number) {
    const el = canvas.current;
    const ctx = el?.getContext('2d');
    if (!el || !ctx) return;
    ctx.clearRect(0, 0, el.width, el.height);
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#7f520a';
    ctx.lineWidth = 2 * devicePixelRatio;
    ctx.lineCap = 'round';

    sparks.current = sparks.current.filter((spark) => {
      const elapsed = now - spark.start;
      if (elapsed >= DURATION) return false;
      const progress = elapsed / DURATION;
      const eased = progress * (2 - progress);
      const distance = eased * RADIUS * devicePixelRatio;
      const length = SIZE * (1 - eased) * devicePixelRatio;
      const x1 = spark.x + distance * Math.cos(spark.angle);
      const y1 = spark.y + distance * Math.sin(spark.angle);
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x1 + length * Math.cos(spark.angle), y1 + length * Math.sin(spark.angle));
      ctx.stroke();
      return true;
    });

    frame.current = sparks.current.length ? requestAnimationFrame(tick) : 0;
  }, []);

  const burst = useCallback<Burst>(
    (x, y) => {
      const el = canvas.current;
      if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
      el.width = innerWidth * devicePixelRatio;
      el.height = innerHeight * devicePixelRatio;
      const start = performance.now();
      for (let i = 0; i < COUNT; i++) {
        sparks.current.push({ x: x * devicePixelRatio, y: y * devicePixelRatio, angle: (2 * Math.PI * i) / COUNT, start });
      }
      if (!frame.current) frame.current = requestAnimationFrame(draw);
    },
    [draw],
  );

  useEffect(() => () => cancelAnimationFrame(frame.current), []);

  const value = useMemo(() => burst, [burst]);

  return (
    <SparkContext.Provider value={value}>
      {children}
      <canvas ref={canvas} className="pointer-events-none fixed inset-0 z-[90] h-full w-full" aria-hidden="true" />
    </SparkContext.Provider>
  );
}

export function useSpark(): Burst {
  return useContext(SparkContext);
}
