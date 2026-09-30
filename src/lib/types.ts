import type { Category } from './library/categories';
import type { Spec } from './ai/schema/display';

export type Mode = 'web' | 'image';
export type EntryStatus = 'queued' | 'analyzing' | 'ready' | 'failed';

export interface EntryImage {
  id: string;
  position: number;
  width: number;
  height: number;
  /** URL paths served by /api/media */
  full: string;
  thumb: string;
  /** Average colour, shown while the image loads. */
  placeholder: string;
}

export interface EntryVersion {
  id: string;
  n: number;
  lens: string;
  note: string;
  spec: Spec;
  provider: string;
  model: string;
  createdAt: string;
}

/** What a gallery card needs. */
export interface EntryCard {
  id: string;
  slug: string;
  name: string;
  category: Category;
  mode: Mode;
  status: EntryStatus;
  /** Human-readable analysis state while the entry is not ready. */
  progress: string | null;
  /** Epoch ms the analysis is waiting for (rate limit), if any. */
  waitUntil: number | null;
  error: string | null;
  favorite: boolean;
  tags: string[];
  imageCount: number;
  cover: EntryImage | null;
  /** True once there is an active version whose prompt can be copied. */
  hasPrompt: boolean;
  createdAt: string;
}

/** Everything the entry page needs. */
export interface EntryDetail extends EntryCard {
  compress: boolean;
  images: EntryImage[];
  versions: EntryVersion[];
  activeVersionId: string | null;
  collectionIds: string[];
  /** The same collections with their names, for chips on the entry page. */
  collections: { id: string; slug: string; name: string }[];
}

export interface Collection {
  id: string;
  slug: string;
  name: string;
  count: number;
  covers: EntryImage[];
  createdAt: string;
}
