'use client';

import { animate, stagger, utils } from 'animejs';
import { motion } from 'motion/react';
import { useCallback, useEffect, useRef, useState } from 'react';

const STRIPS = 14;

interface Props {
  /** Changes when the text is replaced by a different version. */
  id: string;
  text: string;
  /** When true the outgoing text is shredded; otherwise the swap is a plain crossfade. */
  shred: boolean;
  className?: string;
}

/** The outgoing note, cut into vertical strips that drop away like paper through a shredder. */
function Shreds({ text, className, onDone }: { text: string; className: string; onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const strips = root.current?.children;
    if (!strips) return;
    const animation = animate(strips, {
      translateY: () => utils.random(36, 96),
      rotate: () => utils.random(-7, 7),
      opacity: [1, 0],
      duration: 620,
      delay: stagger(26, { from: 'random' }),
      ease: 'inQuad',
      onComplete: onDone,
    });
    return () => {
      animation.cancel();
    };
  }, [onDone]);

  const width = 100 / STRIPS;
  return (
    <div ref={root} className="pointer-events-none absolute inset-x-0 top-0" aria-hidden="true">
      {Array.from({ length: STRIPS }, (_, i) => (
        <p
          key={i}
          className={`${className} ${i === 0 ? '' : 'absolute inset-x-0 top-0'}`}
          style={{ clipPath: `inset(0 ${100 - (i + 1) * width}% 0 ${i * width}%)`, transformOrigin: `${(i + 0.5) * width}% 0` }}
        >
          {text}
        </p>
      ))}
    </div>
  );
}

export function ShredSwap({ id, text, shred, className = '' }: Props) {
  const [shown, setShown] = useState({ id, text });
  const [leaving, setLeaving] = useState<string | null>(null);
  const done = useCallback(() => setLeaving(null), []);

  // Decide during render, so the old text is already falling when the new text first paints.
  if (shown.id !== id) {
    const calm = typeof window === 'undefined' || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setLeaving(shred && !calm ? shown.text : null);
    setShown({ id, text });
  } else if (shown.text !== text) {
    setShown({ id, text });
  }

  return (
    <div className="relative">
      <motion.p
        key={id}
        className={className}
        initial={{ opacity: 0, y: 8, filter: 'blur(6px)' }}
        animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }}
        transition={{ duration: 0.5, delay: leaving ? 0.32 : 0, ease: [0.2, 0.7, 0.1, 1] }}
      >
        {text}
      </motion.p>
      {leaving && <Shreds text={leaving} className={className} onDone={done} />}
    </div>
  );
}
