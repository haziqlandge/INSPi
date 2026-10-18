import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../public/dev/ui-audit.js';

const css = readFileSync(join(process.cwd(), 'src/app/globals.css'), 'utf8');

/** The hex tokens of one theme block (`:root {` or `:root[data-theme="dark"] {`). */
function tokens(selector: string): Record<string, string> {
  const start = css.indexOf(`${selector} {`);
  const block = css.slice(start, css.indexOf('}', start));
  return Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[0-9a-f]{6})/gi)].map((m) => [m[1], m[2]]));
}

const rgb = (hex: string) => [1, 3, 5].map((i) => Number.parseInt(hex.slice(i, i + 2), 16)).concat(1);
const ratio = (a: string, b: string) => contrastRatio(rgb(a), rgb(b)) as number;

/** Text on fill, in every pairing the controls and pages use. */
const PAIRS: [text: string, fill: string][] = [
  ['on-head', 'head'], // selected chips, the Segmented pill, primary buttons
  ['head', 'bg'],
  ['head', 'surface'],
  ['ink', 'bg'],
  ['ink', 'surface'],
  ['muted', 'bg'],
  ['muted', 'surface'],
  ['accent', 'bg'],
  ['accent', 'surface'],
];

describe('colour tokens', () => {
  for (const [name, selector] of [
    ['light', ':root'],
    ['dark', ':root[data-theme="dark"]'],
  ] as const) {
    it(`keep every text-on-fill pair at 4.5:1 or more (${name})`, () => {
      const t = tokens(selector);
      for (const [text, fill] of PAIRS) {
        expect(t[text], `--${text} in ${name}`).toBeDefined();
        expect(ratio(t[text], t[fill]), `--${text} on --${fill}, ${name}`).toBeGreaterThanOrEqual(4.5);
      }
    });
  }
});

describe('selected states', () => {
  it('cannot be overridden by a hover rule: hover rules carry no specificity (:where)', () => {
    // A bare `.chip:hover` or `button.chip:hover` once out-ranked `.chip[aria-pressed="true"]` and hid the label
    expect(css).not.toMatch(/(^|[\s,])(a|button)?\.chip:hover/m);
    expect(css).toMatch(/:where\([^)]*\.chip[^)]*\):hover/);
  });

  it('use the on-head colour for text on a selected fill', () => {
    const pressed = css.slice(css.indexOf('.chip[aria-pressed="true"]'));
    expect(pressed.slice(0, pressed.indexOf('}'))).toMatch(/color:\s*var\(--on-head\)/);
  });
});
