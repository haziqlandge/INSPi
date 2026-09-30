'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { HeartIcon, PlusIcon, SearchIcon } from '@/components/ui/icons';
import { Segmented } from '@/components/ui/segmented';
import { useUpload } from '@/components/upload/upload-provider';
import { useFilters } from '@/lib/client/filters';
import { tagList, toggleTag, useTags } from '@/lib/client/tags';
import { ModelMenu } from './model-menu';

const SEARCH_DELAY_MS = 220;

/** A word being typed after # is a tag in the making, not part of the text search. */
const withoutHashWord = (value: string) => value.replace(/(^|\s)#\S*$/, '').trim();

/** The floating bar that stays in reach on every page: search, filters, and Add. */
export function Dock() {
  const { filters, setFilters } = useFilters();
  const { pick } = useUpload();
  const pathname = usePathname();
  const onLibrary = pathname === '/';
  const [text, setText] = useState(filters.q);
  const input = useRef<HTMLInputElement>(null);
  const tags = useTags();
  const [focused, setFocused] = useState(false);
  const [active, setActive] = useState(-1);
  const timer = useRef<number | undefined>(undefined);

  // Keep the box in step when the URL changes from elsewhere (a tag click, the back button).
  useEffect(() => {
    setText(filters.q);
  }, [filters.q]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      const typing = target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName);
      if (event.key === '/' && !typing && !event.metaKey && !event.ctrlKey) {
        event.preventDefault();
        input.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Tag typeahead: the last word, with or without a leading #, is matched against the tags in use.
  const token = text.split(/\s+/).pop() ?? '';
  const hash = token.startsWith('#');
  const term = token.replace(/^#/, '').toLowerCase();
  const suggestions = useMemo(() => {
    if (!focused || (!hash && term.length < 2)) return [];
    const chosen = tagList(filters.tag);
    return tags
      .filter((tag) => !chosen.includes(tag.name) && tag.name.includes(term))
      .sort((a, b) => Number(b.name.startsWith(term)) - Number(a.name.startsWith(term)) || b.count - a.count)
      .slice(0, 6);
  }, [focused, hash, term, tags, filters.tag]);

  useEffect(() => setActive(-1), [term, hash]);

  function pickTag(name: string) {
    // The typed word is replaced by the tag filter; anything before it stays as a text search.
    const rest = text.slice(0, text.length - token.length).trim();
    window.clearTimeout(timer.current);
    setText(rest);
    setActive(-1);
    setFilters({ tag: toggleTag(filters.tag, name), q: rest });
  }

  function onType(value: string) {
    setText(value);
    window.clearTimeout(timer.current);
    // Away from the library, wait for Enter rather than navigating on every keystroke.
    if (onLibrary) timer.current = window.setTimeout(() => setFilters({ q: withoutHashWord(value) }), SEARCH_DELAY_MS);
  }

  return (
    <nav
      aria-label="Library controls"
      className="fixed inset-x-3 bottom-3 z-50 mx-auto flex max-w-[44rem] items-center gap-1.5 rounded-[1.25rem] border border-line bg-surface/85 p-1.5 shadow-dock backdrop-blur-xl backdrop-saturate-150 sm:bottom-5"
    >
      <form
        role="search"
        className="relative flex min-w-0 flex-1 items-center gap-2 rounded-[0.875rem] pl-3 pr-2 text-muted focus-within:text-head"
        onSubmit={(event) => {
          event.preventDefault();
          window.clearTimeout(timer.current);
          setFilters({ q: withoutHashWord(text) });
        }}
      >
        <SearchIcon className="flex-none" />
        <input
          ref={input}
          type="search"
          value={text}
          onChange={(event) => onType(event.target.value)}
          placeholder="Search names, tags, categories"
          aria-label="Search the library"
          role="combobox"
          aria-expanded={suggestions.length > 0}
          aria-controls="tag-suggestions"
          aria-autocomplete="list"
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (suggestions.length === 0) return;
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
              event.preventDefault();
              const step = event.key === 'ArrowDown' ? 1 : -1;
              setActive((i) => (i + step + suggestions.length) % suggestions.length);
            } else if (event.key === 'Enter' && active >= 0) {
              event.preventDefault();
              pickTag(suggestions[active].name);
            } else if (event.key === 'Tab' && hash) {
              event.preventDefault();
              pickTag(suggestions[Math.max(active, 0)].name);
            }
          }}
          className="h-10 min-w-0 flex-1 bg-transparent text-[0.9375rem] text-ink outline-none placeholder:text-muted/80 [&::-webkit-search-cancel-button]:hidden"
        />
        <kbd className="hidden rounded-md border border-line px-1.5 py-0.5 font-sans text-xs text-muted sm:block">/</kbd>

        {suggestions.length > 0 && (
          <ul
            id="tag-suggestions"
            role="listbox"
            aria-label="Matching tags"
            className="absolute bottom-full left-0 z-[60] mb-3 w-[min(22rem,100%)] overflow-hidden rounded-2xl border border-line bg-surface p-1.5 shadow-lift"
          >
            <li className="px-2.5 pb-1 pt-1 text-xs text-muted">Tags</li>
            {suggestions.map((tag, i) => (
              <li key={tag.name} role="option" aria-selected={i === active}>
                <button
                  type="button"
                  // Keep focus in the search box so the list does not close before the click lands.
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => pickTag(tag.name)}
                  className={`flex w-full items-center gap-2 rounded-xl px-2.5 py-2 text-left text-[0.9375rem] text-ink ${
                    i === active ? 'bg-line/70' : 'hover:bg-line/50'
                  }`}
                >
                  <span className="text-accent">#</span>
                  <span className="min-w-0 flex-1 truncate">{tag.name}</span>
                  <span className="text-xs text-muted">{tag.group}</span>
                  <span className="w-6 text-right text-xs tabular-nums text-muted">{tag.count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </form>

      {onLibrary && (
        <>
          <div className="hidden sm:block">
            <Segmented
              size="sm"
              label="Show"
              value={filters.mode}
              onChange={(mode) => setFilters({ mode })}
              options={[
                { value: '', label: 'All' },
                { value: 'web', label: 'Web' },
                { value: 'image', label: 'Image' },
              ]}
            />
          </div>
          <button
            type="button"
            className="icon-btn"
            aria-pressed={filters.fav}
            aria-label="Show favourites only"
            onClick={() => setFilters({ fav: !filters.fav })}
          >
            <HeartIcon filled={filters.fav} />
          </button>
        </>
      )}

      <ModelMenu />

      <button type="button" className="btn btn-primary h-10 px-4" onClick={pick}>
        <PlusIcon size={16} />
        Add
      </button>
    </nav>
  );
}
