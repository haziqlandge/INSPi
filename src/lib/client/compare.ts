import type { Spec } from '@/lib/ai/schema/display';

/** Side-by-side comparison of two versions of an entry's spec. */

export interface DiffToken {
  text: string;
  kind: 'same' | 'add' | 'del';
}

/** Joins the space between two changed words into the change, so a changed phrase reads as one mark. */
function bridge(tokens: DiffToken[]): DiffToken[] {
  return tokens.map((token, i) =>
    token.kind === 'same' && !token.text.trim() && i > 0 && tokens[i - 1].kind !== 'same' && tokens[i + 1] && tokens[i + 1].kind === tokens[i - 1].kind
      ? { ...token, kind: tokens[i - 1].kind }
      : token,
  );
}

/** Share of words the two texts have in common, 0 to 1. */
export function similarity(diff: { a: DiffToken[]; b: DiffToken[] }): number {
  const words = (tokens: DiffToken[]) => tokens.filter((t) => t.text.trim());
  const kept = words(diff.b).filter((t) => t.kind === 'same').length;
  const total = Math.max(words(diff.a).length, words(diff.b).length);
  return total ? kept / total : 1;
}

/** Word-level diff: the left side marks what was removed, the right side what was added. */
export function wordDiff(a: string, b: string): { a: DiffToken[]; b: DiffToken[] } {
  const left = a.split(/(\s+)/).filter(Boolean);
  const right = b.split(/(\s+)/).filter(Boolean);
  // Past this size the table gets slow and the diff unreadable; show a plain replacement.
  if (left.length * right.length > 250_000) {
    return { a: left.map((text) => ({ text, kind: 'del' })), b: right.map((text) => ({ text, kind: 'add' })) };
  }

  // Longest common subsequence, filled from the end so the walk below goes forwards.
  const n = left.length;
  const m = right.length;
  const table = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      table[i][j] = left[i] === right[j] ? table[i + 1][j + 1] + 1 : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }

  const outA: DiffToken[] = [];
  const outB: DiffToken[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (left[i] === right[j]) {
      outA.push({ text: left[i++], kind: 'same' });
      outB.push({ text: right[j++], kind: 'same' });
    } else if (table[i + 1][j] >= table[i][j + 1]) {
      outA.push({ text: left[i++], kind: 'del' });
    } else {
      outB.push({ text: right[j++], kind: 'add' });
    }
  }
  while (i < n) outA.push({ text: left[i++], kind: 'del' });
  while (j < m) outB.push({ text: right[j++], kind: 'add' });
  return { a: bridge(outA), b: bridge(outB) };
}

export interface CompareRow {
  key: string;
  label: string;
  a: string | null;
  b: string | null;
  changed: boolean;
}

export interface CompareGroup {
  id: string;
  title: string;
  rows: CompareRow[];
  changed: number;
}

/** Identity is the same in every version, and the palette is compared as swatches. */
const SKIP = new Set(['inspi', 'name', 'category', 'tags', 'palette']);
const ORDER = ['note', 'signature', 'patterns', 'blueprint', 'system', 'keep', 'adapt', 'avoid', 'tokens', 'build', 'prompt', 'negative', 'params'];
const FIELD_LABELS: Record<string, string> = {
  value: 'Value',
  evidence: 'Evidence',
  location: 'Location',
  magnitude: 'Magnitude',
  confidence: 'Confidence',
  web: 'CSS',
  gen: 'Prompt fragment',
};

export function humanize(key: string): string {
  const words = key.replace(/_/g, ' ').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

type Leaves = Map<string, { label: string; text: string }>;

/** Flattens a value to labelled text leaves. Lists of plain values become one leaf, a line each. */
function flatten(value: unknown, key: string, label: string, out: Leaves): Leaves {
  if (value === null || value === undefined) return out;
  if (Array.isArray(value)) {
    if (value.every((item) => item === null || typeof item !== 'object')) {
      out.set(key, { label, text: value.map(String).join('\n') });
    } else {
      value.forEach((item, index) => {
        const name = item && typeof item === 'object' && typeof (item as { name?: unknown }).name === 'string' ? (item as { name: string }).name : `${index + 1}`;
        flatten(item, `${key}.${index}`, label ? `${label} › ${name}` : name, out);
      });
    }
    return out;
  }
  if (typeof value === 'object') {
    for (const [child, inner] of Object.entries(value as Record<string, unknown>)) {
      const childLabel = FIELD_LABELS[child] ?? humanize(child);
      flatten(inner, key ? `${key}.${child}` : child, label ? `${label} › ${childLabel}` : childLabel, out);
    }
    return out;
  }
  out.set(key, { label, text: String(value) });
  return out;
}

const same = (a: string | null, b: string | null) => (a ?? '').replace(/\s+/g, ' ').trim() === (b ?? '').replace(/\s+/g, ' ').trim() && (a === null) === (b === null);

function group(id: string, title: string, a: unknown, b: unknown): CompareGroup {
  const left = flatten(a, '', '', new Map());
  const right = flatten(b, '', '', new Map());
  const keys = [...new Set([...left.keys(), ...right.keys()])];
  const rows = keys.map((key): CompareRow => {
    const l = left.get(key)?.text ?? null;
    const r = right.get(key)?.text ?? null;
    return { key, label: right.get(key)?.label ?? left.get(key)?.label ?? '', a: l, b: r, changed: !same(l, r) };
  });
  return { id, title, rows, changed: rows.filter((row) => row.changed).length };
}

export function compareSpecs(a: Spec, b: Spec): CompareGroup[] {
  const left = a as unknown as Record<string, unknown>;
  const right = b as unknown as Record<string, unknown>;
  const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].filter((key) => !SKIP.has(key));
  keys.sort((x, y) => (ORDER.indexOf(x) + 1 || 99) - (ORDER.indexOf(y) + 1 || 99));

  const groups: CompareGroup[] = [];
  for (const key of keys) {
    if (key === 'system') {
      const la = (left.system ?? {}) as Record<string, unknown>;
      const lb = (right.system ?? {}) as Record<string, unknown>;
      for (const dim of [...new Set([...Object.keys(lb), ...Object.keys(la)])]) {
        groups.push(group(`system.${dim}`, humanize(dim), la[dim], lb[dim]));
      }
    } else {
      groups.push(group(key, humanize(key), left[key], right[key]));
    }
  }
  return groups;
}

export function summarize(groups: CompareGroup[]): { dimensions: { changed: number; total: number }; rows: number } {
  const dimensions = groups.filter((g) => g.id.startsWith('system.'));
  return {
    dimensions: { changed: dimensions.filter((g) => g.changed > 0).length, total: dimensions.length },
    rows: groups.reduce((sum, g) => sum + g.changed, 0),
  };
}
