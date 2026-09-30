'use client';

import { motion, useMotionValue, useSpring } from 'motion/react';
import Link from 'next/link';
import { ViewTransition, useEffect, useState, type PointerEvent } from 'react';
import { useToast } from '@/components/feedback/toast';
import { CopyButton } from '@/components/ui/copy-button';
import { HeartIcon, ImagesIcon, RetryIcon, TrashIcon } from '@/components/ui/icons';
import { Skeleton } from '@/components/ui/skeleton';
import { deleteEntry, restoreEntry, retryEntry, setFavorite } from '@/lib/client/actions';
import { toQuery } from '@/lib/client/filters';
import { cachedPrompt, loadPrompt } from '@/lib/client/prompt';
import { useCountdown } from '@/lib/client/use-countdown';
import type { EntryCard as Entry } from '@/lib/types';

/** Very tall or very wide images are cropped on the wall; the entry page shows them whole. */
export function coverRatio(entry: Entry): number {
  if (!entry.cover) return 1;
  return Math.min(1.7, Math.max(0.56, entry.cover.height / entry.cover.width));
}

interface Props {
  entry: Entry;
  /** Position on the wall, used to stagger the first appearance. */
  index: number;
}

export function EntryCard({ entry, index }: Props) {
  const toast = useToast();
  const [favorite, setFavoriteState] = useState(entry.favorite);
  const [busy, setBusy] = useState(false);

  // A refetch may bring a newer value than the one this card last set.
  useEffect(() => setFavoriteState(entry.favorite), [entry.favorite]);

  // The print tips a few degrees towards the pointer, like a photograph picked up by one edge.
  const tiltX = useSpring(useMotionValue(0), { stiffness: 220, damping: 22 });
  const tiltY = useSpring(useMotionValue(0), { stiffness: 220, damping: 22 });
  function onTilt(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== 'mouse') return;
    const rect = event.currentTarget.getBoundingClientRect();
    tiltY.set(((event.clientX - rect.left) / rect.width - 0.5) * 5);
    tiltX.set((0.5 - (event.clientY - rect.top) / rect.height) * 5);
  }
  function onLevel() {
    tiltX.set(0);
    tiltY.set(0);
  }

  const href = `/e/${entry.slug}`;
  const pending = entry.status === 'queued' || entry.status === 'analyzing';
  const countdown = useCountdown(pending ? entry.waitUntil : null);
  const failed = entry.status === 'failed';
  const ready = entry.status === 'ready';
  // On devices with a pointer, the actions stay out of the way until the card is hovered or focused.
  const reveal =
    '[@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:group-hover:opacity-100';

  async function toggleFavorite() {
    const next = !favorite;
    setFavoriteState(next);
    try {
      await setFavorite(entry.id, next);
    } catch (error) {
      setFavoriteState(!next);
      toast.show(error instanceof Error ? error.message : 'That could not be saved.', { tone: 'error' });
    }
  }

  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    try {
      await action();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'That did not work.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const remove = () =>
    run(async () => {
      await deleteEntry(entry.id);
      toast.show('Entry deleted', { action: { label: 'Undo', run: () => void restoreEntry(entry.id) } });
    });

  return (
    <motion.article
      className="print group relative p-2 pb-0"
      style={{ rotateX: tiltX, rotateY: tiltY, transformPerspective: 900 }}
      onPointerMove={onTilt}
      onPointerLeave={onLevel}
      initial={{ opacity: 0, y: 26, rotate: index % 2 ? 1.4 : -1.4, scale: 1.03 }}
      animate={{ opacity: 1, y: 0, rotate: 0, scale: 1 }}
      transition={{ type: 'spring', stiffness: 260, damping: 26, delay: Math.min(index, 14) * 0.045 }}
      whileHover={{ y: -4, transition: { type: 'spring', stiffness: 420, damping: 28 } }}
    >
      <div className="relative">
      <Link
        href={href}
        className="relative block overflow-hidden rounded-[2px]"
        style={{ aspectRatio: `1 / ${coverRatio(entry)}`, backgroundColor: entry.cover?.placeholder ?? 'var(--line)' }}
        aria-label={ready ? `Open ${entry.name}` : 'Open entry'}
      >
        {pending ? (
          <Skeleton className="absolute inset-0" label="Analysing" />
        ) : (
          entry.cover && (
            <ViewTransition name={`cover-${entry.id}`} share="morph" default="none">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={entry.cover.thumb}
                alt=""
                width={entry.cover.width}
                height={entry.cover.height}
                loading={index < 8 ? 'eager' : 'lazy'}
                decoding="async"
                className={`h-full w-full object-cover ${failed ? 'opacity-60 grayscale' : ''}`}
              />
            </ViewTransition>
          )
        )}

        {failed && (
          <span className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#23191b]/85 to-transparent px-3 pb-2.5 pt-8 text-[0.8125rem] font-medium text-[#f6d9be]">
            Could not be analyzed
          </span>
        )}

        {entry.imageCount > 1 && !pending && (
          <span className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-full bg-[#23191b]/75 px-2 py-1 text-xs font-medium text-[#f6d9be] backdrop-blur-sm">
            <ImagesIcon size={13} />
            {entry.imageCount}
          </span>
        )}

      </Link>

      {/* Favourite and quick copy sit on the image's corner, leaving the caption its full width. */}
      {ready && (
        <div className="absolute bottom-2 right-2 flex gap-1">
          <button
            type="button"
            className={`icon-btn h-8 w-8 !bg-surface/90 shadow-print backdrop-blur-sm transition-opacity hover:!bg-surface ${
              favorite ? '!text-accent' : `!text-head ${reveal}`
            }`}
            aria-pressed={favorite}
            aria-label={favorite ? 'Remove from favourites' : 'Add to favourites'}
            onClick={toggleFavorite}
          >
            <motion.span
              key={String(favorite)}
              className="grid place-items-center"
              initial={{ scale: favorite ? 0.5 : 1 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 520, damping: 12 }}
            >
              <HeartIcon size={16} filled={favorite} />
            </motion.span>
          </button>
          <CopyButton
            label="Copy prompt"
            className={`h-8 w-8 !bg-surface/90 !text-head shadow-print backdrop-blur-sm transition-opacity hover:!bg-surface ${reveal}`}
            warm={() => void loadPrompt(entry.id).catch(() => {})}
            text={() => cachedPrompt(entry.id) ?? loadPrompt(entry.id)}
          />
        </div>
      )}
      </div>

      {failed ? (
        <div className="px-1 pb-3 pt-3">
          <p className="font-medium text-muted">Could not be analyzed</p>
          <p className="mt-1 line-clamp-3 text-sm text-muted">{entry.error ?? 'Something went wrong.'}</p>
          <div className="mt-3 flex gap-2">
            <button type="button" className="btn gap-2 px-3 py-2" disabled={busy} onClick={() => run(() => retryEntry(entry.id))}>
              <RetryIcon size={15} />
              Retry
            </button>
            <button type="button" className="btn gap-2 px-3 py-2 hover:!text-danger" disabled={busy} onClick={remove}>
              <TrashIcon size={15} />
              Delete
            </button>
          </div>
        </div>
      ) : pending ? (
        <div className="px-1 pb-3 pt-3" aria-live="polite">
          <Skeleton className="h-[1.3125rem] w-3/5 rounded" />
          <Skeleton className="mt-2.5 h-3 w-2/5 rounded" />
          <Skeleton className="mt-2.5 h-3 w-4/5 rounded" />
          <p className="mt-3 truncate text-[0.8125rem] text-muted">
            {entry.progress ?? 'Waiting its turn'}
            {countdown && <span className="ml-2 tabular-nums text-accent">{countdown}</span>}
          </p>
        </div>
      ) : (
        <div className="flex items-start gap-1 px-1 pb-2.5 pt-2.5">
          <div className="min-w-0 flex-1">
            <Link href={href} className="display block truncate text-[1.3125rem] leading-tight">
              {entry.name}
            </Link>
            <p className="mt-0.5 flex items-center gap-2 truncate text-[0.8125rem] text-muted">
              <Link href={`/?${toQuery({ category: entry.category })}`} className="truncate hover:text-head">
                {entry.category}
              </Link>
              <span className="badge flex-none scale-90">{entry.mode === 'web' ? 'web' : 'img'}</span>
            </p>
            {ready && entry.tags.length > 0 && (
              <p className="mt-1 truncate text-[0.8125rem] text-muted">
                {entry.tags.slice(0, 3).map((tag, i) => (
                  <span key={tag}>
                    {i > 0 && ', '}
                    <Link href={`/?${toQuery({ tag })}`} className="hover:text-head hover:underline">
                      {tag}
                    </Link>
                  </span>
                ))}
              </p>
            )}
          </div>
        </div>
      )}
    </motion.article>
  );
}
