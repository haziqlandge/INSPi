'use client';

import { motion, useReducedMotion } from 'motion/react';
import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A row that opens and closes by growing and shrinking. CSS grid rows go from 0fr to 1fr with a
 * transition; a CSS transition reverses from wherever it stands, so flipping it back and forth fast
 * never jumps or leaves a half-faded copy. Closed, it is inert: nothing in it can be reached.
 * Spacing belongs inside (padding), not on the parent (`space-y`), so a closed row leaves no gap.
 */
export function Collapse({ open, children, className = '' }: { open: boolean; children: ReactNode; className?: string }) {
  return (
    <div className={`ui-collapse ${className}`} data-open={open ? '' : undefined} inert={!open} aria-hidden={!open}>
      <div className="ui-collapse-inner">{children}</div>
    </div>
  );
}

/**
 * Follows its content's height with a spring, for changes that would otherwise jump (a list wrapping
 * onto a new row, a line of text growing to two). Interruptible: a new height retargets from where
 * it is. With reduced motion it simply takes the new height.
 */
export function AutoHeight({ children, className = '' }: { children: ReactNode; className?: string }) {
  const inner = useRef<HTMLDivElement>(null);
  const [height, setHeight] = useState<number | 'auto'>('auto');
  const reduced = useReducedMotion();

  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const observer = new ResizeObserver(() => setHeight(el.offsetHeight));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  return (
    <motion.div
      className={className}
      style={{ overflow: 'hidden' }}
      initial={false}
      animate={{ height }}
      transition={reduced ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 40, mass: 0.6 }}
    >
      <div ref={inner}>{children}</div>
    </motion.div>
  );
}
