'use client';

import { animate, stagger } from 'animejs';
import { useEffect, useMemo, useRef, useState } from 'react';
import CountUp from '@/components/bits/CountUp';
import { SwapIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import { Switch } from '@/components/ui/segmented';
import { compareSpecs, similarity, summarize, wordDiff, type DiffToken } from '@/lib/client/compare';
import type { EntryVersion, Mode } from '@/lib/types';
import { passLabel } from './version-label';

interface Props {
  open: boolean;
  onClose: () => void;
  mode: Mode;
  versions: EntryVersion[];
  activeVersionId: string | null;
  /** The version on screen when Compare was pressed; it goes on the right. */
  viewedId: string | null;
  busy: boolean;
  onUse: (versionId: string) => void;
}

function Tokens({ tokens, side }: { tokens: DiffToken[]; side: 'a' | 'b' }) {
  return (
    <>
      {tokens.map((token, i) =>
        token.kind === 'same' ? (
          <span key={i}>{token.text}</span>
        ) : side === 'a' ? (
          <del key={i} className="rounded-[3px] bg-danger/12 text-danger decoration-danger/50 [box-decoration-break:clone]">
            {token.text}
          </del>
        ) : (
          <ins key={i} className="rounded-[3px] bg-accent/15 text-head no-underline [box-decoration-break:clone]">
            {token.text}
          </ins>
        ),
      )}
    </>
  );
}

function Missing() {
  return <span className="italic text-muted/80">Not in this version</span>;
}

function VersionSelect({ label, value, versions, onChange }: { label: string; value: string; versions: EntryVersion[]; onChange: (id: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-sm text-muted">
      {label}
      <select className="field w-auto py-1.5 pr-8 text-sm" value={value} onChange={(event) => onChange(event.target.value)}>
        {versions.map((v) => (
          <option key={v.id} value={v.id}>
            Version {v.n}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Two versions of the prompt side by side: what each pass saw differently, word by word. */
export function CompareView({ open, onClose, mode, versions, activeVersionId, viewedId, busy, onUse }: Props) {
  const [leftId, setLeftId] = useState('');
  const [rightId, setRightId] = useState('');
  const [changesOnly, setChangesOnly] = useState(true);
  const body = useRef<HTMLDivElement>(null);

  // Opening compares the version on screen with the one before it.
  useEffect(() => {
    if (!open || versions.length < 2) return;
    const index = Math.max(0, versions.findIndex((v) => v.id === viewedId));
    const right = index === 0 ? versions[1] : versions[index];
    const left = index === 0 ? versions[0] : versions[index - 1];
    setLeftId(left.id);
    setRightId(right.id);
  }, [open, versions, viewedId]);

  const left = versions.find((v) => v.id === leftId);
  const right = versions.find((v) => v.id === rightId);
  const groups = useMemo(() => (left && right ? compareSpecs(left.spec, right.spec) : []), [left, right]);
  const summary = summarize(groups);
  const shown = groups
    .map((group) => ({ ...group, rows: changesOnly ? group.rows.filter((row) => row.changed) : group.rows }))
    .filter((group) => group.rows.length > 0);

  // New pair, new cascade.
  useEffect(() => {
    const el = body.current;
    if (!el || !open || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const rows = [...el.querySelectorAll<HTMLElement>('[data-row]')].slice(0, 40);
    const animation = animate(rows, { opacity: [0, 1], translateY: [10, 0], duration: 460, delay: stagger(18), ease: 'outQuart' });
    return () => {
      animation.revert();
    };
  }, [leftId, rightId, changesOnly, open]);

  const palette = (v: EntryVersion | undefined) => v?.spec.palette ?? [];
  const leftHexes = new Set(palette(left).map((c) => c.hex.toLowerCase()));
  const rightHexes = new Set(palette(right).map((c) => c.hex.toLowerCase()));

  const heading = (v: EntryVersion | undefined, side: 'Before' | 'After') =>
    v && (
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span className="text-xs font-medium text-muted">{side}</span>
        <span className="display text-xl">Version {v.n}</span>
        <span className="text-[0.8125rem] text-muted">{passLabel(v, mode)}</span>
        {v.id === activeVersionId ? (
          <span className="badge">cards copy this</span>
        ) : (
          <button type="button" className="text-[0.8125rem] text-ink underline decoration-accent underline-offset-4" onClick={() => onUse(v.id)} disabled={busy}>
            Use this one
          </button>
        )}
      </div>
    );

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Compare versions"
      size="full"
      actions={
        <label className="mr-2 hidden items-center gap-2 text-sm text-muted sm:flex">
          Changes only
          <Switch checked={changesOnly} onChange={setChangesOnly} label="Show changes only" />
        </label>
      }
    >
      {left && right && (
        <div ref={body}>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3">
            <VersionSelect label="Before" value={leftId} versions={versions} onChange={setLeftId} />
            <button
              type="button"
              className="icon-btn"
              aria-label="Swap before and after"
              onClick={() => {
                setLeftId(rightId);
                setRightId(leftId);
              }}
            >
              <SwapIcon />
            </button>
            <VersionSelect label="After" value={rightId} versions={versions} onChange={setRightId} />
            <label className="flex items-center gap-2 text-sm text-muted sm:hidden">
              Changes only
              <Switch checked={changesOnly} onChange={setChangesOnly} label="Show changes only" />
            </label>
          </div>

          <p className="mt-5 text-[1.0625rem] text-ink" aria-live="polite">
            {leftId === rightId ? (
              'Pick two different versions.'
            ) : (
              <>
                <CountUp key={`${leftId}-${rightId}`} to={summary.dimensions.changed} duration={0.8} className="display tabular-nums text-accent" /> of{' '}
                {summary.dimensions.total} dimensions read differently, {summary.rows} {summary.rows === 1 ? 'line' : 'lines'} in all.
              </>
            )}
          </p>

          {(right.steer?.note || left.steer?.note) && (
            <div className="mt-4 grid gap-3 lg:grid-cols-2">
              {[left, right].map((v) => (
                <p key={v.id} className="text-sm text-muted">
                  {v.steer?.note ? <>Your note for version {v.n}: “{v.steer.note}”</> : null}
                </p>
              ))}
            </div>
          )}

          <div className="sticky top-[var(--modal-head,0px)] z-[5] -mx-5 mt-6 hidden border-b border-line bg-surface/95 px-5 py-3 backdrop-blur-sm sm:-mx-7 sm:px-7 lg:grid lg:grid-cols-2 lg:gap-8">
            {heading(left, 'Before')}
            {heading(right, 'After')}
          </div>
          <div className="mt-6 space-y-3 lg:hidden">
            {heading(left, 'Before')}
            {heading(right, 'After')}
          </div>

          <section className="mt-6" data-row>
            <h3 className="text-sm font-medium text-head">Palette</h3>
            <div className="mt-2 grid gap-4 lg:grid-cols-2 lg:gap-8">
              {[
                { v: left, other: rightHexes, kind: 'del' },
                { v: right, other: leftHexes, kind: 'add' },
              ].map(({ v, other, kind }) => (
                <ul key={v.id} className="flex flex-wrap gap-2">
                  {palette(v).map((color, i) => {
                    const fresh = !other.has(color.hex.toLowerCase());
                    return (
                      <li
                        key={`${color.hex}-${i}`}
                        className={`flex items-center gap-2 rounded-full border py-1 pl-1 pr-2.5 text-xs ${
                          fresh ? (kind === 'add' ? 'border-accent text-head' : 'border-danger/60 text-danger') : 'border-line text-muted'
                        }`}
                        title={`${color.role}, ${Math.round(color.share * 100)}% of the frame`}
                      >
                        <span className="h-5 w-5 rounded-full border border-line" style={{ background: color.hex }} />
                        <span className="font-mono">{color.hex.toUpperCase()}</span>
                        <span>{color.role}</span>
                      </li>
                    );
                  })}
                </ul>
              ))}
            </div>
          </section>

          {shown.length === 0 && leftId !== rightId && <p className="mt-10 text-center text-muted">These two versions say the same thing.</p>}

          <div className="mt-8 space-y-8">
            {shown.map((group) => (
              <section key={group.id} aria-label={group.title}>
                <h3 className="flex items-baseline gap-2 border-b border-line pb-2">
                  <span className="display text-[1.3125rem]">{group.title}</span>
                  {group.changed > 0 && (
                    <span className="text-xs tabular-nums text-muted">
                      {group.changed} {group.changed === 1 ? 'change' : 'changes'}
                    </span>
                  )}
                </h3>
                <div className="divide-y divide-line/70">
                  {group.rows.map((row) => {
                    const words = row.changed && row.a !== null && row.b !== null ? wordDiff(row.a, row.b) : null;
                    // A rewrite reads better as two plain texts than as a wall of marks.
                    const diff = words && similarity(words) >= 0.3 ? words : null;
                    const rewritten = Boolean(words && !diff);
                    return (
                      <div key={row.key} data-row className="py-3">
                        {(row.label || rewritten) && (
                          <p className="mb-1.5 text-xs font-medium text-muted">
                            {row.label}
                            {rewritten && <span className="ml-2 font-normal text-accent">rewritten</span>}
                          </p>
                        )}
                        <div className={`grid gap-2 whitespace-pre-line text-[0.9375rem] leading-relaxed lg:grid-cols-2 lg:gap-8 ${row.changed ? 'text-ink' : 'text-muted'}`}>
                          <div>
                            <span className="mr-2 text-[0.6875rem] font-medium text-muted lg:hidden">v{left.n}</span>
                            {row.a === null ? <Missing /> : diff ? <Tokens tokens={diff.a} side="a" /> : row.a}
                          </div>
                          <div>
                            <span className="mr-2 text-[0.6875rem] font-medium text-muted lg:hidden">v{right.n}</span>
                            {row.b === null ? <Missing /> : diff ? <Tokens tokens={diff.b} side="b" /> : row.b}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
