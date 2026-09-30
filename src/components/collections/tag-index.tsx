'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { SearchIcon } from '@/components/ui/icons';
import { toQuery } from '@/lib/client/filters';
import { useTags } from '@/lib/client/tags';
import { OTHER_GROUP, TAG_GROUPS } from '@/lib/library/vocabulary';

const GROUP_ORDER = [...TAG_GROUPS.map((g) => g.group), OTHER_GROUP];

/** Every tag in use, grouped, each one a link to the library filtered by it. */
export function TagIndex() {
  const tags = useTags();
  const [find, setFind] = useState('');
  const needle = find.trim().toLowerCase();

  const groups = useMemo(() => {
    const byGroup = new Map<string, typeof tags>();
    for (const tag of tags) {
      if (needle && !tag.name.includes(needle)) continue;
      byGroup.set(tag.group, [...(byGroup.get(tag.group) ?? []), tag]);
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ group: g, tags: byGroup.get(g)! }));
  }, [tags, needle]);

  if (tags.length === 0) return null;

  return (
    <section className="mt-16" aria-labelledby="tag-index-heading">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div>
          <h2 id="tag-index-heading" className="display text-[clamp(1.75rem,3.5vw,2.5rem)] leading-none">
            Tags
          </h2>
          <p className="mt-2 text-muted">Every tag in use. Pick one to see its entries.</p>
        </div>
        <label className="flex w-full max-w-sm items-center gap-2 rounded-xl border border-line bg-surface px-3 focus-within:border-head">
          <SearchIcon className="flex-none text-muted" />
          <input
            type="search"
            value={find}
            onChange={(event) => setFind(event.target.value)}
            placeholder="Find a tag"
            aria-label="Find a tag"
            className="h-11 min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-muted/80 [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      </div>

      <div className="mt-6 grid gap-x-10 gap-y-7 md:grid-cols-2">
        {groups.map(({ group, tags: list }) => (
          <div key={group}>
            <h3 className="mb-2 text-[0.8125rem] font-medium uppercase tracking-[0.08em] text-muted">{group}</h3>
            <div className="flex flex-wrap gap-1.5">
              {list.map((tag) => (
                <Link key={tag.name} href={`/?${toQuery({ tag: tag.name })}`} className="chip">
                  {tag.name} <span className="tabular-nums opacity-70">{tag.count}</span>
                </Link>
              ))}
            </div>
          </div>
        ))}
        {groups.length === 0 && <p className="text-muted">No tag matches “{find}”.</p>}
      </div>
    </section>
  );
}
