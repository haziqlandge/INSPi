'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Suspense } from 'react';
import { ApertureIcon, GaugeIcon, SettingsIcon, TerminalIcon } from '@/components/ui/icons';
import { McpButton } from './mcp-button';
import { ThemeToggle } from './theme-toggle';
import { Wordmark } from './wordmark';

const LINKS = [
  { href: '/', label: 'Library', match: (path: string) => path === '/' || path.startsWith('/e/') },
  { href: '/collections', label: 'Collections', match: (path: string) => path.startsWith('/collections') },
  // On phones there is no room for a third word; the aperture icon beside Usage stands in for it.
  { href: '/visualize', label: 'Visualize', match: (path: string) => path.startsWith('/visualize'), wide: true },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="flex items-center gap-3 px-4 pb-2 pt-4 sm:gap-8 sm:px-8 sm:pt-6">
      <Link href="/" aria-label="INSPi library" className="rounded-md">
        <Wordmark />
      </Link>
      <nav aria-label="Sections" className="flex items-center gap-1 text-[0.9375rem]">
        {LINKS.map((link) => {
          const current = link.match(pathname);
          return (
            <Link
              key={link.href}
              href={link.href}
              aria-current={current ? 'page' : undefined}
              className={`rounded-full px-2 py-1.5 transition-colors sm:px-3 ${'wide' in link ? 'hidden sm:inline' : ''} ${
                current ? 'text-head underline decoration-accent decoration-2 underline-offset-[6px]' : 'text-muted hover:text-head'
              }`}
            >
              {link.label}
            </Link>
          );
        })}
      </nav>
      <div className="ml-auto flex items-center">
        <ThemeToggle />
        <Link
          href="/visualize"
          className="icon-btn sm:!hidden"
          aria-label="Visualize"
          aria-current={pathname.startsWith('/visualize') ? 'page' : undefined}
        >
          <ApertureIcon />
        </Link>
        <Link href="/usage" className="icon-btn max-sm:!hidden" aria-label="Usage" aria-current={pathname === '/usage' ? 'page' : undefined}>
          <GaugeIcon />
        </Link>
        {/* Reads ?tab= to mark itself current; its own boundary keeps the pages statically rendered */}
        <Suspense fallback={<span className="icon-btn max-sm:!hidden" aria-hidden><TerminalIcon /></span>}>
          <McpButton />
        </Suspense>
        <Link href="/settings" className="icon-btn" aria-label="Settings" aria-current={pathname === '/settings' ? 'page' : undefined}>
          <SettingsIcon />
        </Link>
      </div>
    </header>
  );
}
