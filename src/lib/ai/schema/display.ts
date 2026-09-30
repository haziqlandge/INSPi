import type { Category } from '../../library/categories';
import type { Blueprint, PaletteColor, TypeTokens } from './wire';

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
}

export interface WebSpec extends SpecBase {
  inspi: 'web/1';
  /** What to build and where: sections, verbatim copy, illustrated pieces. Absent on older entries. */
  blueprint?: Blueprint;
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
}

export type Spec = WebSpec | ImageSpec;
