'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import BlurText from '@/components/bits/BlurText';
import { PlusIcon } from '@/components/ui/icons';
import { useUpload } from '@/components/upload/upload-provider';
import type { ProviderStatus } from '@/lib/ai/status';
import { api } from '@/lib/client/api';
import { useFilters } from '@/lib/client/filters';
import { useEntries } from '@/lib/client/use-entries';
import { CategoryRail } from './category-rail';
import { Wall } from './wall';

const PAGE = 60;

function NoProviderNotice() {
  const [missing, setMissing] = useState(false);
  useEffect(() => {
    api<{ providers: ProviderStatus[] }>('/api/providers')
      .then(({ providers }) => setMissing(!providers.some((p) => p.usable)))
      .catch(() => {});
  }, []);
  if (!missing) return null;
  return (
    <p className="mb-5 rounded-xl border border-danger/40 bg-danger/5 px-4 py-3 text-[0.9375rem] text-ink">
      No AI key was found, so new images cannot be analysed yet. Add <code className="font-mono text-sm">GROQ_API_KEY</code> to the{' '}
      <code className="font-mono text-sm">.env</code> file, restart the server, then check{' '}
      <Link href="/settings" className="underline decoration-accent underline-offset-4">
        Settings
      </Link>
      .
    </p>
  );
}

function EmptyLibrary() {
  const { pick } = useUpload();
  return (
    <section className="mx-auto grid max-w-5xl items-center gap-10 py-[min(12vh,7rem)] md:grid-cols-[1.1fr_0.9fr]">
      <div>
        <h1 className="display text-[clamp(2.5rem,6vw,4.75rem)] leading-[0.98]">
          <BlurText text="Drop in something you would like to build from." delay={70} animateBy="words" direction="bottom" className="flex flex-wrap" />
        </h1>
        <p className="mt-6 max-w-[34rem] text-[1.0625rem] leading-relaxed text-ink">
          INSPi reads the design system inside an image and writes a prompt another AI can follow to recreate the look. Each
          image you add is kept here with its name, category, tags and that prompt.
        </p>
        <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-3">
          <button type="button" className="btn btn-primary px-5 py-3.5 text-[0.9375rem]" onClick={pick}>
            <PlusIcon size={16} />
            Add an image
          </button>
          <p className="text-[0.9375rem] text-muted">
            or paste with <kbd className="rounded-md border border-line px-1.5 py-0.5 font-sans text-[0.8125rem]">Ctrl</kbd>{' '}
            <kbd className="rounded-md border border-line px-1.5 py-0.5 font-sans text-[0.8125rem]">V</kbd>, or drop a file
            anywhere
          </p>
        </div>
      </div>

      {/* Three blank prints waiting on the table. */}
      <div className="relative mx-auto hidden aspect-square w-full max-w-sm md:block" aria-hidden="true">
        {[
          { rotate: '-7deg', x: '-8%', y: '6%' },
          { rotate: '5deg', x: '12%', y: '-4%' },
          { rotate: '-1.5deg', x: '2%', y: '10%' },
        ].map((p, i) => (
          <div
            key={i}
            className="print absolute inset-[12%] p-3 pb-10"
            style={{ transform: `translate(${p.x}, ${p.y}) rotate(${p.rotate})` }}
          >
            <div className="h-full w-full rounded-[2px] border border-dashed border-muted/40 bg-paper/60" />
          </div>
        ))}
      </div>
    </section>
  );
}

function Skeleton() {
  return (
    <div className="grid grid-cols-2 gap-5 md:grid-cols-3 xl:grid-cols-4" aria-hidden="true">
      {[1.3, 0.8, 1.1, 0.9].map((ratio, i) => (
        <div key={i} className="print p-2 pb-12 opacity-60">
          <div className="rounded-[2px] bg-line/60 motion-safe:animate-pulse" style={{ aspectRatio: `1 / ${ratio}` }} />
        </div>
      ))}
    </div>
  );
}

export function Library() {
  const { filters, setFilters, query } = useFilters();
  const [limit, setLimit] = useState(PAGE);
  const { data, error } = useEntries(`${query}${query ? '&' : ''}limit=${limit}`);
  const filtering = Boolean(query);

  // A new filter starts again from the first page.
  useEffect(() => setLimit(PAGE), [query]);

  if (error && !data) {
    return <p className="py-16 text-center text-danger">{error}</p>;
  }
  if (!data) return <Skeleton />;

  if (data.total === 0 && !filtering) {
    return (
      <>
        <NoProviderNotice />
        <EmptyLibrary />
      </>
    );
  }

  return (
    <>
      <h1 className="sr-only">Library</h1>
      <NoProviderNotice />
      <CategoryRail categories={data.categories} total={data.total} filters={filters} setFilters={setFilters} />

      <div className="mt-5">
        {data.items.length > 0 ? (
          <Wall entries={data.items} />
        ) : (
          <div className="py-20 text-center">
            <p className="display text-3xl">Nothing matches that.</p>
            <p className="mt-2 text-muted">Try fewer words, or clear the filters.</p>
            <button
              type="button"
              className="btn mt-5"
              onClick={() => setFilters({ q: '', category: '', tag: '', mode: '', fav: false })}
            >
              Clear filters
            </button>
          </div>
        )}
      </div>

      {data.total > data.items.length && (
        <div className="mt-10 text-center">
          <button type="button" className="btn" onClick={() => setLimit((n) => n + PAGE)}>
            Show more
          </button>
        </div>
      )}
    </>
  );
}
