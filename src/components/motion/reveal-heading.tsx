'use client';

import { animate, onScroll, stagger } from 'animejs';
import { useEffect, useRef, type ElementType } from 'react';

interface Props {
  children: string;
  as?: ElementType;
  className?: string;
  id?: string;
}

/**
 * A heading that sets itself as it scrolls into view: each word comes out of a blur and settles
 * onto the baseline, tied to the scroll position so it can be scrubbed back and forth. The effect is
 * React Bits' Scroll Reveal, driven by anime.js's scroll observer instead of GSAP.
 */
export function RevealHeading({ children, as: Tag = 'h2', className = '', id }: Props) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // A heading the page cannot scroll far enough to finish would stay half-set: show it as it is.
    const maxScroll = document.documentElement.scrollHeight - window.innerHeight;
    const topAtMax = el.getBoundingClientRect().top + window.scrollY - maxScroll;
    if (topAtMax > window.innerHeight * 0.62) return;
    const words = el.querySelectorAll<HTMLElement>('[data-word]');
    const observer = () =>
      onScroll({
        target: el,
        enter: { target: 'top', container: 'bottom' },
        leave: { target: 'top', container: '62%' },
        sync: 0.35,
      });
    const settle = animate(el, { rotate: [2.5, 0], ease: 'linear', autoplay: observer() });
    const set = animate(words, {
      opacity: [0.08, 1],
      filter: ['blur(7px)', 'blur(0px)'],
      translateY: ['0.28em', '0em'],
      delay: stagger(90),
      ease: 'linear',
      autoplay: observer(),
    });
    return () => {
      settle.revert();
      set.revert();
    };
  }, [children]);

  const parts = children.split(/(\s+)/);
  return (
    <Tag ref={ref} id={id} className={`origin-left ${className}`} aria-label={children}>
      {parts.map((part, i) =>
        part.trim() ? (
          <span key={i} data-word aria-hidden="true" className="inline-block will-change-[filter,opacity,transform]">
            {part}
          </span>
        ) : (
          <span key={i} aria-hidden="true">
            {part}
          </span>
        ),
      )}
    </Tag>
  );
}
