import type { Mode } from '../../types';

export interface Lens {
  id: string;
  label: string;
  /** Extra instruction for the observe pass; empty for the balanced first pass. */
  focus: (mode: Mode) => string;
}

const emphasis = (what: string) =>
  `Emphasis for this pass: ${what}. Give those dimensions your most precise measurements; keep the rest brief but complete.`;

/** Each retry looks from a different angle, so a new version is a second opinion rather than a re-roll. */
export const LENSES: Lens[] = [
  { id: 'balanced', label: 'Balanced', focus: () => '' },
  {
    id: 'structure',
    label: 'Structure first',
    focus: () => emphasis('structure — composition, geometry, hierarchy, alignment, negative space, density and rhythm'),
  },
  {
    id: 'surface',
    label: 'Surface first',
    focus: () => emphasis('surface — colour system, contrast, lighting, material, texture, gradients, shadows and overlays'),
  },
  {
    id: 'detail',
    label: 'Type and detail first',
    focus: () => emphasis('type and detail — typography, borders, corners, shapes, repetition and image treatment'),
  },
  {
    id: 'behaviour',
    label: 'Behaviour first',
    focus: (mode) =>
      mode === 'web'
        ? emphasis('behaviour — what the static evidence implies for interaction, motion and responsive layout, plus depth and perspective')
        : emphasis('making — medium and technique, camera and lens, how subjects are treated, plus depth and perspective'),
  },
];

/** Version 1 is balanced; later versions cycle through the other lenses. */
export function lensForVersion(n: number): Lens {
  if (n <= 1) return LENSES[0];
  return LENSES[1 + ((n - 2) % (LENSES.length - 1))];
}

export function lensById(id: string): Lens {
  return LENSES.find((l) => l.id === id) ?? LENSES[0];
}
