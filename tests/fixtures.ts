import { dimensionsFor } from '@/lib/ai/schema/dimensions';
import type { Blueprint, ImageTranslation, Observation, WebTranslation } from '@/lib/ai/schema/wire';
import type { Mode } from '@/lib/types';

export function sampleBlueprint(): Blueprint {
  return {
    canvas: 'Desktop page, 1440 wide, dusk-violet ground, content centred at 960.',
    sections: [
      {
        name: 'Header',
        box: 'top 0, h 80, full width',
        layout: 'flex row, logo left, 5 links right, 24px gaps',
        content: 'Logo "Dusk" 28px/700; links "Work", "About" 16px/500 #F2A65A',
        style: 'bottom border 1px #3A2E5C',
      },
      {
        name: 'Hero',
        box: 'y 200-640, 960 wide, centred',
        layout: 'stacked, centre aligned, 24px gaps',
        content: 'h1 "Light after dark" 88px/500; button "Start" 18px',
        style: 'button fill #F2A65A, radius 999',
      },
    ],
    assets: [{ name: 'Glass panel', look: 'frosted rounded rectangle 1px white 30% stroke', placement: '3, stepped 40px down-right, rotated -4deg' }],
  };
}

export function sampleObservation(mode: Mode, overrides: Partial<Observation> = {}): Observation {
  const d: Observation['d'] = {};
  for (const key of dimensionsFor(mode)) {
    d[key] = { v: `${key} value`, e: `${key} evidence`, l: 'centre', m: '50%', c: 0.7 };
  }
  return {
    gist: 'Three frosted panels over a dusk gradient.',
    keywords: ['frosted glass', 'dusk gradient', 'neon lights'],
    signature: ['stepped translucent panels', 'single warm light', 'violet-black ground'],
    palette: [
      { hex: '#1B1430', role: 'background', share: 0.58 },
      { hex: '#F2A65A', role: 'accent', share: 0.15 },
    ],
    d,
    ...overrides,
  };
}

export function sampleWebTranslation(): WebTranslation {
  const web: Record<string, string> = {};
  for (const key of dimensionsFor('web')) web[key] = `${key} css`;
  return {
    name: 'Glass Dusk',
    category: 'Landing Page',
    tags: ['frosted glass', 'dusk gradient'],
    collections: ['Glass & Blur'],
    note: 'Frosted panels float over a dusk gradient.',
    web,
    tokens: {
      colors: [
        { role: 'background', hex: '#1B1430' },
        { role: 'accent', hex: '#F2A65A' },
      ],
      type: {
        display: 'Fraunces, Georgia, serif',
        text: 'Instrument Sans, system-ui, sans-serif',
        mono: 'Geist Mono, monospace',
        scale: '1.25 ratio from 16px',
        weights: '400 / 500',
        tracking: '-0.02em display',
        leading: '1.6 body',
      },
      spacing: '8px unit',
      radius: '14px',
      border: '1px rgb(255 255 255 / .3)',
      shadow: '0 20px 30px -18px rgb(10 5 25 / .6)',
      motion: '240ms cubic-bezier(.2,.7,.1,1)',
    },
    build: ['Set the gradient.', 'Build one panel.'],
    avoid: ['opaque cards'],
  };
}

export function sampleImageTranslation(): ImageTranslation {
  const gen: Record<string, string> = {};
  for (const key of dimensionsFor('image')) gen[key] = `${key} phrase`;
  return {
    name: 'Glass Dusk',
    category: '3D & Render',
    tags: ['frosted glass'],
    collections: [],
    note: 'Frosted panels float over a dusk gradient.',
    gen,
    prompt: 'Three frosted translucent panels stepping diagonally over a violet to amber gradient.',
    negative: ['hard shadows', 'text'],
    params: { aspect_ratio: '4:5', medium: '3D render', notes: 'soft global illumination' },
  };
}
