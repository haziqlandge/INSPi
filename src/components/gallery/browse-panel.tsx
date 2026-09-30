'use client';

import { useMemo, useState } from 'react';
import { SearchIcon } from '@/components/ui/icons';
import { Modal } from '@/components/ui/modal';
import type { Filters } from '@/lib/client/filters';
import { tagList, toggleTag, type TagInfo } from '@/lib/client/tags';
import { OTHER_GROUP, TAG_GROUPS } from '@/lib/library/vocabulary';

interface Props {
  open: boolean;
  onClose: () => void;
  categories: { name: string; count: number }[];
  tags: TagInfo[];
  total: number;
  filters: Filters;
  setFilters: (patch: Partial<Filters>) => void;
}

const GROUP_ORDER = [...TAG_GROUPS.map((g) => g.group), OTHER_GROUP];

/**
 * Everything the library can be narrowed by, in one place: categories, then tags grouped as
 * Style, Subject, Colour and so on. Pick several tags and only entries with all of them stay.
 */
export function BrowsePanel({ open, onClose, categories, tags, total, filters, setFilters }: Props) {
  const [find, setFind] = useState('');
  const needle = find.trim().toLowerCase();
  const selected = tagList(filters.tag);

  const groups = useMemo(() => {
    const byGroup = new Map<string, TagInfo[]>();
    for (const tag of tags) {
      if (needle && !tag.name.includes(needle)) continue;
      byGroup.set(tag.group, [...(byGroup.get(tag.group) ?? []), tag]);
    }
    return GROUP_ORDER.filter((g) => byGroup.has(g)).map((g) => ({ group: g, tags: byGroup.get(g)! }));
  }, [tags, needle]);

  const shownCategories = categories.filter((c) => !needle || c.name.toLowerCase().includes(needle));
  const filtering = Boolean(filters.category || filters.tag);

  return (
    <Modal open={open} onClose={onClose} title="Browse by category and tag" wide>
      <label className="flex items-center gap-2 rounded-xl border border-line bg-paper/60 px-3 focus-within:border-head">
        <SearchIcon className="flex-none text-muted" />
        <input
          data-autofocus
          type="search"
          value={find}
          onChange={(event) => setFind(event.target.value)}
          placeholder="Find a category or tag"
          aria-label="Find a category or tag"
          className="h-11 min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-muted/80 [&::-webkit-search-cancel-button]:hidden"
        />
      </label>

      <div className="mt-5 space-y-6">
        {shownCategories.length > 0 && (
          <section aria-label="Categories">
            <h3 className="mb-2 text-[0.8125rem] font-medium uppercase tracking-[0.08em] text-muted">Category</h3>
            <div className="flex flex-wrap gap-1.5">
              {shownCategories.map((category) => (
                <button
                  key={category.name}
                  type="button"
                  className="chip"
                  aria-pressed={filters.category === category.name}
                  onClick={() => setFilters({ category: filters.category === category.name ? '' : category.name })}
                >
                  {category.name} <span className="tabular-nums opacity-70">{category.count}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {groups.map(({ group, tags: list }) => (
          <section key={group} aria-label={group}>
            <h3 className="mb-2 text-[0.8125rem] font-medium uppercase tracking-[0.08em] text-muted">{group}</h3>
            <div className="flex flex-wrap gap-1.5">
              {list.map((tag) => (
                <button
                  key={tag.name}
                  type="button"
                  className="chip"
                  aria-pressed={selected.includes(tag.name)}
                  onClick={() => setFilters({ tag: toggleTag(filters.tag, tag.name) })}
                >
                  {tag.name} <span className="tabular-nums opacity-70">{tag.count}</span>
                </button>
              ))}
            </div>
          </section>
        ))}

        {shownCategories.length === 0 && groups.length === 0 && (
          <p className="py-6 text-center text-muted">No category or tag matches “{find}”.</p>
        )}
      </div>

      <div className="mt-6 flex items-center justify-between gap-3 border-t border-line pt-4">
        <button type="button" className="btn px-3.5 py-2" onClick={() => setFilters({ category: '', tag: '' })} disabled={!filtering}>
          Clear
        </button>
        <button type="button" className="btn btn-primary px-4 py-2" onClick={onClose}>
          Show {total} {total === 1 ? 'entry' : 'entries'}
        </button>
      </div>
    </Modal>
  );
}
