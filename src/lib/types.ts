import type { Category } from './library/categories';
import type { Spec } from './ai/schema/display';
import type { ProviderId } from './ai/client';
import type { BackendId } from './imagine/types';

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

/** A retry run with a provider (and models) other than the one in use. Only that provider is tried. */
export interface RunChoice {
  provider: ProviderId;
  vision?: string;
  text?: string;
}

/** What a guided retry was asked to look at: focus area ids and the person's own note. */
export interface Steer {
  focus: string[];
  note: string;
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
  /** Set when this version came from a guided retry. */
  steer: Steer | null;
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
  /** Up to seven colours measured from the images, biggest share first; null until measured. */
  palette: PaletteSwatch[] | null;
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
  /** Palettes rolled from the measured one and kept, newest first. */
  palettes: SavedPalette[];
}

/** One measured colour and the share of the image it covers (0–1). */
export interface PaletteSwatch {
  hex: string;
  share: number;
}

export interface SavedPalette {
  id: string;
  colors: string[];
  createdAt: string;
}

/** A generated image, made from an entry's prompt or in the Visualize playground. */
export interface Render {
  id: string;
  entryId: string | null;
  entrySlug: string | null;
  entryName: string | null;
  versionId: string | null;
  backend: BackendId;
  model: string;
  prompt: string;
  seed: number | null;
  width: number;
  height: number;
  url: string;
  createdAt: string;
}

export interface Collection {
  id: string;
  slug: string;
  name: string;
  count: number;
  covers: EntryImage[];
  createdAt: string;
}
