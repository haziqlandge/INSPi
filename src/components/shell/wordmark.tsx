'use client';

import { useEffect, useRef } from 'react';

const LETTERS = ['I', 'N', 'S', 'P', 'i'];
/** How far, in pixels, the cursor's pull reaches. */
const RADIUS = 140;

/**
 * The name set in Fraunces, whose weight and softness swell towards the cursor.
 * It runs on the font's own variable axes, so nothing moves or reflows around it.
 */
export function Wordmark() {
  const letters = useRef<(HTMLSpanElement | null)[]>([]);

  useEffect(() => {
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    let frame = 0;
    let x = -9999;
    let y = -9999;

    const paint = () => {
      frame = 0;
      for (const el of letters.current) {
        if (!el) continue;
        const rect = el.getBoundingClientRect();
        const distance = Math.hypot(x - (rect.left + rect.width / 2), y - (rect.top + rect.height / 2));
        const pull = Math.max(0, 1 - distance / RADIUS) ** 2;
        el.style.fontVariationSettings = `"wght" ${Math.round(400 + pull * 380)}, "SOFT" ${Math.round(60 + pull * 40)}, "opsz" 144`;
      }
    };
    const onMove = (event: PointerEvent) => {
      x = event.clientX;
      y = event.clientY;
      if (!frame) frame = requestAnimationFrame(paint);
    };
    const onLeave = () => {
      x = y = -9999;
      if (!frame) frame = requestAnimationFrame(paint);
    };

    window.addEventListener('pointermove', onMove, { passive: true });
    document.documentElement.addEventListener('pointerleave', onLeave);
    return () => {
      window.removeEventListener('pointermove', onMove);
      document.documentElement.removeEventListener('pointerleave', onLeave);
      cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <span className="display inline-flex select-none text-[1.75rem] leading-none tracking-[-0.03em]" aria-hidden="true">
      {LETTERS.map((letter, index) => (
        <span
          key={index}
          ref={(el) => {
            letters.current[index] = el;
          }}
          className="transition-[font-variation-settings] duration-300 ease-out"
          style={{ fontVariationSettings: '"wght" 400, "SOFT" 60, "opsz" 144' }}
        >
          {letter}
        </span>
      ))}
    </span>
  );
}
