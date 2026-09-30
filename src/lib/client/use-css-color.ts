'use client';

import { useEffect, useState } from 'react';

/**
 * Resolves a CSS custom property to a concrete colour and follows theme switches.
 * Canvas-drawn effects cannot read `var(--accent)` themselves.
 */
export function useCssColor(variable: string, fallback: string): string {
  const [color, setColor] = useState(fallback);

  useEffect(() => {
    const read = () => {
      const value = getComputedStyle(document.documentElement).getPropertyValue(variable).trim();
      if (value) setColor(value);
    };
    read();
    const observer = new MutationObserver(read);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    return () => observer.disconnect();
  }, [variable]);

  return color;
}
