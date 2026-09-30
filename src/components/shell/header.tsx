'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { SettingsIcon } from '@/components/ui/icons';
import { ThemeToggle } from './theme-toggle';
import { Wordmark } from './wordmark';

const LINKS = [
  { href: '/', label: 'Library', match: (path: string) => path === '/' || path.startsWith('/e/') },
  { href: '/collections', label: 'Collections', match: (path: string) => path.startsWith('/collections') },
];

export function Header() {
  const pathname = usePathname();
  return (
    <header className="flex items-center gap-4 px-4 pb-2 pt-4 sm:gap-8 sm:px-8 sm:pt-6">
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
              className={`rounded-full px-3 py-1.5 transition-colors ${
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
        <Link href="/settings" className="icon-btn" aria-label="Settings" aria-current={pathname === '/settings' ? 'page' : undefined}>
          <SettingsIcon />
        </Link>
      </div>
    </header>
  );
}
