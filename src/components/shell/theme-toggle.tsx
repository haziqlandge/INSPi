'use client';

import { useRef } from 'react';
import { MoonIcon, SunIcon } from '@/components/ui/icons';

export const THEME_KEY = 'inspi-theme';

/** Runs before first paint so a saved dark preference never flashes light. */
export const themeScript = `try{if(localStorage.getItem('${THEME_KEY}')==='dark')document.documentElement.dataset.theme='dark'}catch(e){}`;

function apply(theme: 'light' | 'dark') {
  const root = document.documentElement;
  if (theme === 'dark') root.dataset.theme = 'dark';
  else delete root.dataset.theme;
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // private mode: the choice simply lasts for this visit
  }
}

export function ThemeToggle() {
  const button = useRef<HTMLButtonElement>(null);

  function toggle() {
    const root = document.documentElement;
    const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    if (!document.startViewTransition || reduced || !button.current) {
      apply(next);
      return;
    }

    // The new theme spreads out from the button like light from a lamp.
    const rect = button.current.getBoundingClientRect();
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    const radius = Math.hypot(Math.max(x, innerWidth - x), Math.max(y, innerHeight - y));

    root.classList.add('theme-switching');
    const transition = document.startViewTransition(() => apply(next));
    transition.ready
      .then(() => {
        root.animate(
          { clipPath: [`circle(0px at ${x}px ${y}px)`, `circle(${radius}px at ${x}px ${y}px)`] },
          { duration: 620, easing: 'cubic-bezier(.2,.7,.1,1)', pseudoElement: '::view-transition-new(root)' },
        );
      })
      // The browser may skip the animation (a hidden tab, another transition running); the theme still changes.
      .catch(() => {});
    transition.finished.catch(() => {}).finally(() => root.classList.remove('theme-switching'));
  }

  return (
    <button ref={button} type="button" className="icon-btn" onClick={toggle} aria-label="Switch between light and dark">
      <MoonIcon className="dark:hidden" />
      <SunIcon className="hidden dark:block" />
    </button>
  );
}
