'use client';

import { motion } from 'motion/react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '@/components/feedback/toast';
import { CopyButton } from '@/components/ui/copy-button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ArrowLeftIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FolderIcon,
  HeartIcon,
  PencilIcon,
  RetryIcon,
  TrashIcon,
} from '@/components/ui/icons';
import { lensById } from '@/lib/ai/prompts/lenses';
import { deleteEntry, restoreEntry, retryEntry, setFavorite, updateEntry } from '@/lib/client/actions';
import { api, LIBRARY_CHANGED } from '@/lib/client/api';
import { toQuery } from '@/lib/client/filters';
import { useCountdown } from '@/lib/client/use-countdown';
import { composePrompt, specJson } from '@/lib/copy/compose';
import type { EntryDetail } from '@/lib/types';
import { CollectionsDialog } from './collections-dialog';
import { EditDialog } from './edit-dialog';
import { ImageStack } from './image-stack';
import { JsonBlock } from './json-block';
import { MoreEntries } from './more-entries';
import { ShredSwap } from './shred-swap';

const POLL_MS = 2000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Written out by hand so the server and the browser always agree on it. */
function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function EntryView({ initial }: { initial: EntryDetail }) {
  const router = useRouter();
  const toast = useToast();
  const [entry, setEntry] = useState(initial);
  const [viewedId, setViewedId] = useState(initial.activeVersionId);
  /** The version that just arrived from a retry: its note replaces the old one with a shred. */
  const [arrivedId, setArrivedId] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [collecting, setCollecting] = useState(false);
  const [busy, setBusy] = useState(false);
  const versionCount = useRef(initial.versions.length);

  const pending = entry.status === 'queued' || entry.status === 'analyzing';
  const countdown = useCountdown(entry.waitUntil);

  // Follow the analysis while it runs, and pick up edits made elsewhere.
  useEffect(() => {
    const load = async () => {
      try {
        setEntry(await api<EntryDetail>(`/api/entries/${entry.id}`));
      } catch {
        // deleted or unreachable: keep showing what we have
      }
    };
    window.addEventListener(LIBRARY_CHANGED, load);
    const timer = pending ? window.setInterval(load, POLL_MS) : undefined;
    return () => {
      window.removeEventListener(LIBRARY_CHANGED, load);
      window.clearInterval(timer);
    };
  }, [entry.id, pending]);

  // When a new version lands, show it.
  useEffect(() => {
    if (entry.versions.length > versionCount.current) {
      const newest = entry.versions[entry.versions.length - 1];
      setArrivedId(versionCount.current > 0 ? newest.id : null);
      setViewedId(newest.id);
    }
    versionCount.current = entry.versions.length;
  }, [entry.versions]);

  const index = Math.max(0, entry.versions.findIndex((v) => v.id === viewedId));
  const version = entry.versions[index];
  const json = useMemo(() => (version ? specJson(version.spec) : ''), [version]);
  const isActive = version?.id === entry.activeVersionId;

  async function run<T>(action: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    try {
      return await action();
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'That did not work.', { tone: 'error' });
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  function step(delta: number) {
    const next = entry.versions[(index + delta + entry.versions.length) % entry.versions.length];
    setArrivedId(null);
    setViewedId(next.id);
  }

  const retry = () =>
    run(async () => {
      setEntry(await retryEntry(entry.id));
    });

  const toggleFavorite = () =>
    run(async () => {
      setEntry(await setFavorite(entry.id, !entry.favorite));
    });

  const makeActive = () =>
    run(async () => {
      if (!version) return;
      setEntry(await updateEntry(entry.id, { activeVersionId: version.id }));
      toast.show(`Version ${version.n} is now the one cards copy`);
    });

  const remove = () =>
    run(async () => {
      await deleteEntry(entry.id);
      toast.show('Entry deleted', { action: { label: 'Undo', run: () => void restoreEntry(entry.id) } });
      router.push('/');
    });

  return (
    <div className="px-4 pt-2 sm:px-8">
      <Link href="/" className="inline-flex items-center gap-2 rounded-full py-2 pr-3 text-[0.9375rem] text-muted hover:text-head">
        <ArrowLeftIcon size={16} />
        Library
      </Link>

      <div className="mt-3 grid items-start gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,34rem)] lg:gap-14 xl:gap-20">
        <ImageStack
          entryId={entry.id}
          images={entry.images}
          name={entry.name}
          developing={pending && entry.versions.length === 0}
          failed={entry.status === 'failed'}
        />

        <article className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[0.875rem] text-muted">
            {version && (
              <Link
                href={`/?${toQuery({ category: entry.category })}`}
                className="text-ink underline decoration-line underline-offset-4 hover:decoration-accent"
              >
                {entry.category}
              </Link>
            )}
            <span className="badge">{entry.mode === 'web' ? 'web' : 'img'}</span>
            <span>
              {entry.images.length} {entry.images.length === 1 ? 'image' : 'images'}
            </span>
            <div className="ml-auto flex items-center">
              <button
                type="button"
                className="icon-btn"
                aria-pressed={entry.favorite}
                aria-label={entry.favorite ? 'Remove from favourites' : 'Add to favourites'}
                onClick={toggleFavorite}
              >
                <motion.span
                  key={String(entry.favorite)}
                  className="grid place-items-center"
                  initial={{ scale: entry.favorite ? 0.5 : 1 }}
                  animate={{ scale: 1 }}
                  transition={{ type: 'spring', stiffness: 520, damping: 12 }}
                >
                  <HeartIcon filled={entry.favorite} />
                </motion.span>
              </button>
              <button type="button" className="icon-btn" onClick={() => setCollecting(true)} aria-label="Add to a collection">
                <FolderIcon />
              </button>
              {version && (
                <button type="button" className="icon-btn" onClick={() => setEditing(true)} aria-label="Edit name, category and tags">
                  <PencilIcon />
                </button>
              )}
              <button type="button" className="icon-btn hover:!text-danger" onClick={remove} disabled={busy} aria-label="Delete entry">
                <TrashIcon />
              </button>
            </div>
          </div>

          {!version ? (
            entry.status === 'failed' ? (
              <div className="mt-4">
                <h1 className="display text-[clamp(2.75rem,5.4vw,5rem)] leading-[0.98] text-muted">Could not be analyzed</h1>
                <p className="mt-5 max-w-[34rem] text-[1.0625rem] leading-relaxed text-ink">{entry.error}</p>
                <div className="mt-6 flex gap-2">
                  <button type="button" className="btn btn-primary" onClick={retry} disabled={busy}>
                    <RetryIcon size={16} />
                    Retry
                  </button>
                  <button type="button" className="btn hover:!text-danger" onClick={remove} disabled={busy}>
                    <TrashIcon size={16} />
                    Delete
                  </button>
                </div>
              </div>
            ) : (
              <div className="mt-5" aria-live="polite">
                <Skeleton className="h-[clamp(2.75rem,5.4vw,4.5rem)] w-4/5 rounded-md" />
                <div className="mt-7 max-w-[34rem] space-y-3">
                  <Skeleton className="h-4 w-full rounded" />
                  <Skeleton className="h-4 w-[92%] rounded" />
                  <Skeleton className="h-4 w-2/3 rounded" />
                </div>
                <div className="mt-6 flex flex-wrap gap-1.5">
                  {['w-20', 'w-16', 'w-24', 'w-14', 'w-20'].map((width, i) => (
                    <Skeleton key={i} className={`h-7 rounded-full ${width}`} />
                  ))}
                </div>
                <div className="mt-7 flex gap-2">
                  <Skeleton className="h-11 w-36 rounded-full" />
                  <Skeleton className="h-11 w-24 rounded-full" />
                </div>
                <Skeleton className="mt-7 h-56 w-full rounded-2xl" />
                <p className="mt-5 text-[1.0625rem] text-muted">
                  {entry.progress ?? 'Waiting its turn'}
                  {countdown && <span className="ml-2 tabular-nums text-accent">{countdown}</span>}
                </p>
              </div>
            )
          ) : (
            <>
              <h1 className="display mt-3 text-[clamp(2.75rem,5.4vw,5rem)] leading-[0.98] [text-wrap:balance]">{entry.name}</h1>

              <div className="mt-5 min-h-[5rem]">
                <ShredSwap
                  id={version.id}
                  text={version.note}
                  shred={version.id === arrivedId}
                  className="max-w-[34rem] text-[1.0625rem] leading-[1.6] text-ink [text-wrap:pretty]"
                />
              </div>

              {entry.collections.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-1.5" aria-label="Collections">
                  {entry.collections.map((collection) => (
                    <li key={collection.id}>
                      <Link href={`/collections/${collection.slug}`} className="chip border-accent/50 text-accent">
                        <FolderIcon size={12} />
                        {collection.name}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              {entry.tags.length > 0 && (
                <ul className="mt-4 flex flex-wrap gap-1.5">
                  {entry.tags.map((tag) => (
                    <li key={tag}>
                      <Link href={`/?${toQuery({ tag })}`} className="chip">
                        {tag}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}

              <div className="mt-6 flex flex-wrap items-center gap-2">
                <CopyButton variant="primary" label="Copy prompt" text={() => composePrompt(version.spec)}>
                  Copy prompt
                </CopyButton>
                <button type="button" className="btn" onClick={retry} disabled={busy || pending}>
                  <RetryIcon size={16} className={pending ? 'motion-safe:animate-spin' : ''} />
                  {pending ? 'Retrying' : 'Retry'}
                </button>

                {entry.versions.length > 1 && (
                  <div className="ml-auto flex items-center text-[0.8125rem] tabular-nums text-muted">
                    <button type="button" className="icon-btn h-8 w-8" onClick={() => step(-1)} aria-label="Previous version">
                      <ChevronLeftIcon size={16} />
                    </button>
                    <span aria-live="polite">
                      {version.n} of {entry.versions.length}
                    </span>
                    <button type="button" className="icon-btn h-8 w-8" onClick={() => step(1)} aria-label="Next version">
                      <ChevronRightIcon size={16} />
                    </button>
                  </div>
                )}
              </div>

              {pending && (
                <p className="mt-3 text-sm text-muted" aria-live="polite">
                  {entry.progress ?? 'Waiting its turn'}
                  {countdown && <span className="ml-2 tabular-nums text-accent">{countdown}</span>}
                </p>
              )}
              {!pending && entry.error && (
                <p className="mt-3 rounded-xl border border-danger/40 bg-danger/5 px-3.5 py-2.5 text-sm text-ink">
                  The last retry did not finish. {entry.error}
                </p>
              )}
              {!isActive && (
                <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted">
                  You are looking at an older version. Cards copy version{' '}
                  {entry.versions.find((v) => v.id === entry.activeVersionId)?.n}.
                  <button type="button" className="text-ink underline decoration-accent underline-offset-4" onClick={makeActive} disabled={busy}>
                    Use this one instead
                  </button>
                </p>
              )}

              <JsonBlock json={json} />

              <p className="mt-8 text-[0.8125rem] leading-relaxed text-muted">
                Version {version.n}, {lensById(version.lens).label.toLowerCase()} pass. Analysed with {version.provider} (
                {version.model}) on {shortDate(version.createdAt)}.
              </p>
            </>
          )}
        </article>
      </div>

      <MoreEntries entryId={entry.id} tags={entry.tags} />

      <EditDialog
        entry={entry}
        open={editing}
        onClose={() => setEditing(false)}
        onSaved={(saved) => {
          setEntry(saved);
          // A new name means a new address; keep the URL in step without adding a history entry.
          if (saved.slug !== entry.slug) router.replace(`/e/${saved.slug}`);
        }}
      />
      <CollectionsDialog
        entryId={entry.id}
        memberOf={entry.collectionIds}
        open={collecting}
        onClose={() => setCollecting(false)}
        onChange={(collectionIds) => setEntry((current) => ({ ...current, collectionIds }))}
      />
    </div>
  );
}
