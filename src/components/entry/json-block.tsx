'use client';

import { animate, stagger } from 'animejs';
import { useEffect, useMemo, useRef, useState } from 'react';
import { CopyButton } from '@/components/ui/copy-button';
import { ChevronDownIcon } from '@/components/ui/icons';
import { jsonLines } from '@/lib/client/json-lines';

/** Lines visible before the block fades out. */
const PREVIEW_LINES = 8;
const LINE_EM = 1.7;

const CLASS = { key: 'json-key', number: 'json-number', string: '', plain: '' } as const;

interface Props {
  json: string;
}

/**
 * The prompt's JSON. Only the first lines show, fading into the card; the arrow opens the rest.
 * The copy button here copies the JSON alone, without the instruction.
 */
export function JsonBlock({ json }: Props) {
  const [open, setOpen] = useState(false);
  const lines = useMemo(() => jsonLines(json), [json]);
  const code = useRef<HTMLPreElement>(null);

  // A different version starts closed again.
  useEffect(() => setOpen(false), [json]);

  function toggle() {
    const next = !open;
    setOpen(next);
    const el = code.current;
    if (!el) return;
    if (!next) {
      el.scrollTop = 0;
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    // The newly uncovered lines arrive in a quick cascade.
    const revealed = [...el.querySelectorAll<HTMLElement>('.json-line')].slice(PREVIEW_LINES - 2, PREVIEW_LINES + 22);
    animate(revealed, {
      opacity: [0, 1],
      translateY: [8, 0],
      duration: 420,
      delay: stagger(22),
      ease: 'outCubic',
    });
  }

  return (
    <div className="relative mt-5 rounded-[10px] border border-line bg-surface">
      <pre
        ref={code}
        tabIndex={0}
        aria-label="Prompt JSON"
        className={`json-scroll m-0 overflow-x-hidden whitespace-normal py-3.5 pl-4 pr-12 font-mono text-[0.78125rem] leading-[1.7] text-ink transition-[max-height] duration-[420ms] ease-settle ${
          open ? 'overflow-y-auto overscroll-contain' : 'overflow-y-hidden'
        }`}
        style={{
          maxHeight: open ? 'min(62dvh, 40em)' : `${PREVIEW_LINES * LINE_EM + 1.6}em`,
          maskImage: open ? 'none' : 'linear-gradient(#000 38%, transparent 97%)',
          WebkitMaskImage: open ? 'none' : 'linear-gradient(#000 38%, transparent 97%)',
        }}
      >
        {lines.map((line, i) => (
          <span key={i} className="json-line" style={{ '--indent': line.indent } as React.CSSProperties}>
            {line.tokens.map((token, j) => (
              <span key={j} className={CLASS[token.kind]}>
                {token.text}
              </span>
            ))}
            {line.tokens.length === 0 && ' '}
          </span>
        ))}
      </pre>

      <CopyButton label="Copy JSON" text={json} className="absolute right-2 top-1.5" />

      <button
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-label={open ? 'Collapse the JSON' : 'Show the full JSON'}
        className="absolute -bottom-3.5 left-1/2 grid h-7 w-7 -translate-x-1/2 place-items-center rounded-full border border-line bg-surface text-muted transition-colors hover:text-head"
      >
        <ChevronDownIcon size={15} className={`transition-transform duration-300 ${open ? 'rotate-180' : ''}`} />
      </button>
    </div>
  );
}
