'use client';

import { useEffect, useState } from 'react';
import { CopyButton } from '@/components/ui/copy-button';
import { api } from '@/lib/client/api';

/** Settings section: the commands that connect Claude Code, Cursor and others to INSPi over MCP. */
export function CodingAgents({ first = false }: { first?: boolean }) {
  const [setup, setSetup] = useState<{ claude: string; json: string } | null>(null);
  useEffect(() => {
    api<{ claude: string; json: string }>('/api/mcp').then(setSetup, () => setSetup(null));
  }, []);

  return (
    <section className={first ? 'mt-8' : 'mt-12'} aria-labelledby="agents-heading">
      <h2 id="agents-heading" className="display text-[1.75rem] leading-tight">
        Coding agents
      </h2>
      <p className="mt-2 max-w-[38rem] text-muted">
        Let Claude Code, Cursor or another MCP client search this library and fetch prompts by name, for example “build the
        hero from my Pink Coin Hero reference”. It can only read; nothing in the library changes. The app does not need to be
        running.
      </p>
      {setup && (
        <div className="mt-5 space-y-4">
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-head">Claude Code</p>
              <CopyButton label="Copy command" text={() => setup.claude} />
            </div>
            <p className="mt-0.5 text-[0.9375rem] text-muted">Run once in a terminal. It is then available in every project.</p>
            <pre className="mt-3 overflow-x-auto whitespace-pre-wrap break-all rounded-lg bg-paper/70 p-3 font-mono text-[0.78125rem] text-ink">{setup.claude}</pre>
          </div>
          <div className="rounded-2xl border border-line bg-surface p-5">
            <div className="flex items-start justify-between gap-3">
              <p className="font-medium text-head">Cursor and other clients</p>
              <CopyButton label="Copy JSON" text={() => setup.json} />
            </div>
            <p className="mt-0.5 text-[0.9375rem] text-muted">
              Add this to the client’s MCP settings (in Cursor, <code className="font-mono text-sm">~/.cursor/mcp.json</code>).
            </p>
            <pre className="mt-3 overflow-x-auto rounded-lg bg-paper/70 p-3 font-mono text-[0.78125rem] text-ink">{setup.json}</pre>
          </div>
        </div>
      )}
    </section>
  );
}
