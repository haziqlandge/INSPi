'use client';

import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { CopyButton } from '@/components/ui/copy-button';
import { TerminalIcon } from '@/components/ui/icons';
import { Popover } from '@/components/ui/popover';
import { api } from '@/lib/client/api';

interface Setup {
  claude: string;
  tools: string[];
}

/**
 * The header's MCP button: the command that connects Claude Code to this library, a copy button,
 * what a connected agent can do, and the way to the full MCP settings. Reads ?tab= to mark itself
 * current, so it sits inside its own Suspense boundary (see Header).
 */
export function McpButton() {
  const pathname = usePathname();
  const tab = useSearchParams()?.get('tab');
  const [open, setOpen] = useState(false);
  const [setup, setSetup] = useState<Setup | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open || setup) return;
    api<Setup>('/api/mcp').then(setSetup, () => setSetup(null));
  }, [open, setup]);

  return (
    <>
      <button
        ref={button}
        type="button"
        // Phones have no room for a fourth icon (as with Usage); there it is Settings' MCP tab
        className="icon-btn max-sm:!hidden"
        aria-label="Connect a coding agent (MCP)"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-current={pathname === '/settings' && tab === 'mcp' ? 'page' : undefined}
        onClick={() => setOpen((v) => !v)}
      >
        <TerminalIcon />
      </button>
      <Popover open={open} anchor={button} onClose={close} label="Connect a coding agent" width={400}>
        <p className="font-medium text-head">Connect a coding agent</p>
        <p className="mt-1 text-[0.8125rem] leading-snug text-muted">Run once in a terminal; Claude Code can then search this library and fetch prompts. It only reads.</p>
        {setup ? (
          <>
            <div className="mt-3 flex items-start gap-2">
              <pre className="min-w-0 flex-1 overflow-hidden whitespace-pre-wrap break-all rounded-lg bg-paper/70 p-2.5 font-mono text-[0.75rem] leading-relaxed text-ink">{setup.claude}</pre>
              <CopyButton label="Copy command" text={() => setup.claude} />
            </div>
            <p className="mt-3 text-[0.75rem] text-muted">
              Tools: <span className="font-mono text-ink">{setup.tools.join(', ')}</span>
            </p>
          </>
        ) : (
          <p className="mt-3 text-[0.8125rem] text-muted">Reading the command…</p>
        )}
        <Link href="/settings?tab=mcp" className="mt-3 inline-block text-[0.8125rem] text-ink underline decoration-line underline-offset-4 hover:decoration-accent" onClick={close}>
          All MCP settings
        </Link>
      </Popover>
    </>
  );
}
