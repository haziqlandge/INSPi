'use client';

import { useCallback, useRef, useState } from 'react';
import { RunModels, useRunChoice } from '@/components/entry/run-with';
import { ChevronDownIcon } from '@/components/ui/icons';
import { Collapse } from '@/components/ui/collapse';
import { Popover } from '@/components/ui/popover';
import { Segmented } from '@/components/ui/segmented';
import type { ProviderId } from '@/lib/ai/client';
import type { RunChoice } from '@/lib/types';

const shortModel = (id: string) => id.split('/').pop()?.replace(/:free$/, '') ?? id;

/**
 * The New entry window's choice of provider and models, as one small button naming the provider
 * that will read the images. It opens a panel to change the provider or its models for this run
 * only. Same contract as the Retry dialog's RunWith.
 */
export function RunButton({ open, onChange }: { open: boolean; onChange: (run: RunChoice | null, ready: boolean) => void }) {
  const run = useRunChoice(open, onChange);
  const [panel, setPanel] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setPanel(false), []);
  const { ready, keyed, current, vision, text, pick, changed } = run;
  // Opens in place once the settings have loaded, instead of popping in
  if (!ready || !current) return <Collapse open={false}>{null}</Collapse>;

  const models = vision ? [vision, text].filter(Boolean).map(shortModel).filter((m, i, all) => all.indexOf(m) === i).join(' → ') : 'pick a model that reads images';

  return (
    <Collapse open>
    <div className="flex items-center justify-between gap-4 pt-5">
      <p className="text-sm text-muted">Reads and writes with</p>
      <button
        ref={button}
        type="button"
        className="btn h-9 min-w-0 max-w-[65%] gap-2 px-3 text-sm"
        aria-haspopup="dialog"
        aria-expanded={panel}
        onClick={() => setPanel((v) => !v)}
        title={changed ? 'Changed for this run' : 'The provider in use'}
      >
        {changed && <span className="h-1.5 w-1.5 flex-none rounded-full bg-accent" aria-label="changed for this run" />}
        <span className="flex-none font-medium text-head">{current.label}</span>
        <span className={`min-w-0 truncate ${vision ? 'text-muted' : 'text-danger'}`}>{models}</span>
        <ChevronDownIcon size={14} className="flex-none text-muted" />
      </button>
      <Popover open={panel} anchor={button} onClose={close} label="Provider and models for this run">
        {keyed.length > 1 && (
          <Segmented<ProviderId> label="Provider" size="sm" value={current.id} onChange={pick} options={keyed.map((p) => ({ value: p.id, label: p.label }))} />
        )}
        <RunModels run={run} stacked />
      </Popover>
    </div>
    </Collapse>
  );
}
