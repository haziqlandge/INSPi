'use client';

import { useState } from 'react';
import { ChevronDownIcon, CloseIcon } from '@/components/ui/icons';
import type { Filters } from '@/lib/client/filters';
import { tagList, toggleTag, useTags } from '@/lib/client/tags';
import { BrowsePanel } from './browse-panel';

interface Props {
  categories: { name: string; count: number }[];
  total: number;
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
}

const TOP_TAGS = 8;

/**
 * The library's index: All, the most used tags, and a More button that opens every category and
 * tag. Whatever is narrowing the view shows here too, each with a cross to remove it.
 */
export function CategoryRail({ categories, total, filters, setFilters }: Props) {
  const tags = useTags();
  const [browsing, setBrowsing] = useState(false);
  const all = categories.reduce((sum, c) => sum + c.count, 0);
  const selected = tagList(filters.tag);
  const top = tags.slice(0, TOP_TAGS).filter((tag) => !selected.includes(tag.name));

  return (
    <>
      <div className="no-scrollbar -mx-4 flex items-center gap-1.5 overflow-x-auto px-4 pb-1 sm:-mx-8 sm:px-8">
        <button
          type="button"
          className="chip"
          aria-pressed={!filters.category && selected.length === 0}
          onClick={() => setFilters({ category: '', tag: '' })}
        >
          All <span className="tabular-nums opacity-70">{all}</span>
        </button>

        {filters.category && (
          <button
            type="button"
            className="chip order-1 border-accent text-accent"
            onClick={() => setFilters({ category: '' })}
            aria-label={`Stop filtering by ${filters.category}`}
          >
            {filters.category}
            <CloseIcon size={12} />
          </button>
        )}

        {selected.map((tag) => (
          <button
            key={tag}
            type="button"
            className="chip order-1 border-accent text-accent"
            onClick={() => setFilters({ tag: toggleTag(filters.tag, tag) })}
            aria-label={`Stop filtering by ${tag}`}
          >
            {tag}
            <CloseIcon size={12} />
          </button>
        ))}

        {top.map((tag) => (
          <button
            key={tag.name}
            type="button"
            className="chip order-3"
            aria-pressed={false}
            onClick={() => setFilters({ tag: toggleTag(filters.tag, tag.name) })}
          >
            {tag.name} <span className="tabular-nums opacity-70">{tag.count}</span>
          </button>
        ))}

        {/* Right after All on phones, where the row scrolls; after the tags where there is room. */}
        <button type="button" className="chip order-2 flex-none sm:order-4" aria-haspopup="dialog" onClick={() => setBrowsing(true)}>
          More
          <ChevronDownIcon size={13} />
        </button>

        {/* On phones the dock has no room for the web / image switch, so it lives here. */}
        {(['web', 'image'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            className="chip order-5 sm:hidden"
            aria-pressed={filters.mode === mode}
            onClick={() => setFilters({ mode: filters.mode === mode ? '' : mode })}
          >
            {mode === 'web' ? 'Web only' : 'Image only'}
          </button>
        ))}

        {(filters.q || filters.tag || filters.category || filters.mode || filters.fav) && (
          <span className="order-6 ml-2 flex-none whitespace-nowrap text-[0.8125rem] text-muted">
            {total} {total === 1 ? 'entry' : 'entries'}
          </span>
        )}
      </div>

      <BrowsePanel
        open={browsing}
        onClose={() => setBrowsing(false)}
        categories={categories}
        tags={tags}
        total={total}
        filters={filters}
        setFilters={setFilters}
      />
    </>
  );
}
