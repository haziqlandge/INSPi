// Rewrites the index at the top of src/components/fx/library.tsx from the `@fx` tags in it:
// one line per component saying what it does, the line it starts on and where it came from.
// Run `npm run fx:index` after adding or moving a component.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const START = '/* FX-INDEX:START';
const END = 'FX-INDEX:END */';
// `/** @fx Name | does | source */` on one line, or ` * @fx Name | does | source` inside a block.
const TAG = /^(?:\/\*\*\s*|\*\s*)@fx ([^|]+?)\s*\|\s*([^|]+?)\s*\|\s*(.+?)\s*(?:\*\/)?$/;

export function buildIndex(source) {
  const lines = source.split('\n');
  const start = lines.findIndex((l) => l.trim() === START);
  const end = lines.findIndex((l, i) => i > start && l.trim() === END);
  if (start < 0 || end < 0) throw new Error(`library.tsx needs "${START}" and "${END}" lines.`);

  const before = lines.slice(0, start);
  const after = lines.slice(end + 1);
  const tags = [];
  after.forEach((line, i) => {
    const match = TAG.exec(line.trim());
    if (match) tags.push({ name: match[1], does: match[2], source: match[3], offset: i });
  });

  // The block is START, one line per tag, then END, so its size is known before numbering.
  const firstAfter = before.length + tags.length + 2 + 1;
  const entries = tags.map((t) => `${t.name} — ${t.does} — line ${firstAfter + t.offset} — ${t.source}`);
  return [...before, START, ...entries, END, ...after].join('\n');
}

const isCli = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isCli) {
  const file = new URL('../src/components/fx/library.tsx', import.meta.url);
  const source = readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
  const next = buildIndex(source);
  if (next !== source) writeFileSync(file, next);
  console.log(next === source ? 'FX index already up to date.' : 'FX index rewritten.');
}
