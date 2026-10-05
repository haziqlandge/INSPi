import type { Category } from '../../library/categories';
import type { Blueprint, Importance, PaletteColor, Patterns, TypeTokens } from './wire';

/** What an image prompt does with the reference's subject: recreate it, use the person's, or leave it to the model. */
export type SubjectMode = 'recreate' | 'mine' | 'model';

/** The readable JSON a user sees and copies. */
interface FindingBase {
  value: string;
  evidence: string;
  location: string;
  magnitude: string;
  confidence: number;
}

export interface WebFinding extends FindingBase {
  /** CSS / layout translation */
  web: string;
  /** Seen in the image, or inferred from it (behaviour, and anything below 0.5 confidence). Absent on web/1. */
  basis?: 'observed' | 'inferred';
  /** How much this dimension matters to the look. Absent on web/1. */
  priority?: Importance;
}

export interface ImageFinding extends FindingBase {
  /** prompt fragment for an image generator */
  gen: string;
}

interface SpecBase {
  name: string;
  category: Category;
  tags: string[];
  note: string;
  signature: string[];
  palette: PaletteColor[];
  /** Changes from the reference the person asked for when adding the entry; every prompt states them. */
  changes?: string;
}

/**
 * web/2 is for inspiration: the page's transferable patterns, and what to keep, adapt and avoid.
 * web/1 (entries made before 1 Oct 2026) transcribed the page instead, in `blueprint`.
 */
export interface WebSpec extends SpecBase {
  inspi: 'web/1' | 'web/2';
  /** web/1 only: sections, verbatim copy, illustrated pieces. */
  blueprint?: Blueprint;
  /** web/2: page grammar, components, signature motif and how to transform it, copy voice. */
  patterns?: Omit<Patterns, 'identity'>;
  /** web/2: principles to carry over as they are. */
  keep?: string[];
  /** web/2: patterns to redesign around the destination project. */
  adapt?: string[];
  system: Record<string, WebFinding>;
  tokens: {
    colors: Record<string, string>;
    type: TypeTokens;
    spacing: string;
    radius: string;
    border: string;
    shadow: string;
    motion: string;
  };
  build: string[];
  avoid: string[];
}

export interface ImageSpec extends SpecBase {
  inspi: 'image/1';
  system: Record<string, ImageFinding>;
  prompt: string;
  negative: string[];
  params: { aspect_ratio: string; medium: string; notes: string };
  /**
   * What the reference shows (subject and setting). Only used when Visualize is asked to recreate the
   * picture; the style prompt itself never names it. Absent on entries made before 4 Oct 2026.
   */
  subject?: string;
  /** The prompt this entry gives by default (Copy prompt, Visualize): chosen when adding it, changeable later. */
  subjectMode?: SubjectMode;
  /** The person's own subject, when `subjectMode` is "mine". */
  mySubject?: string;
}

export type Spec = WebSpec | ImageSpec;
