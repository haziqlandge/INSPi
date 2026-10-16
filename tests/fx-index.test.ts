import { describe, expect, it } from 'vitest';
import { buildIndex } from '../scripts/fx-index.mjs';

const SOURCE = [
  "'use client';",
  '',
  '/* FX-INDEX:START',
  'FX-INDEX:END */',
  '',
  "/** @fx Alpha | does the first thing | React Bits */",
  'export function Alpha() {}',
  '',
  "/** @fx Beta | does the second thing | recreated from https://example.com */",
  'export function Beta() {}',
  '',
].join('\n');

describe('buildIndex', () => {
  it('lists every @fx component with the line it starts on', () => {
    const out: string = buildIndex(SOURCE);
    const lines = out.split('\n');
    const alphaLine = lines.findIndex((l) => l.startsWith('/** @fx Alpha')) + 1;
    const betaLine = lines.findIndex((l) => l.startsWith('/** @fx Beta')) + 1;
    expect(out).toContain(`Alpha — does the first thing — line ${alphaLine} — React Bits`);
    expect(out).toContain(`Beta — does the second thing — line ${betaLine} — recreated from https://example.com`);
  });

  it('is stable when run twice', () => {
    const once: string = buildIndex(SOURCE);
    expect(buildIndex(once)).toBe(once);
  });
});

describe('buildIndex with multi-line comments', () => {
  it('reads an @fx line inside a JSDoc block', () => {
    const source = ['/* FX-INDEX:START', 'FX-INDEX:END */', '/**', ' * @fx Gamma | does a third thing | UI Layouts', ' */', 'export function Gamma() {}'].join('\n');
    const out: string = buildIndex(source);
    const line = out.split('\n').findIndex((l) => l.includes('* @fx Gamma')) + 1;
    expect(out).toContain(`Gamma — does a third thing — line ${line} — UI Layouts`);
  });
});
