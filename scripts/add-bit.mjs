/**
 * Copies React Bits components (TypeScript + Tailwind variants) into src/components/bits.
 * Same result as the shadcn CLI, without needing a components.json.
 *
 *   node scripts/add-bit.mjs DecryptedText ClickSpark
 *
 * React Bits is free to use (MIT + Commons Clause): https://reactbits.dev
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error('Usage: node scripts/add-bit.mjs <ComponentName> [more]');
  process.exit(1);
}

const out = join(process.cwd(), 'src', 'components', 'bits');
await mkdir(out, { recursive: true });

const dependencies = new Set();
for (const name of names) {
  const response = await fetch(`https://reactbits.dev/r/${name}-TS-TW`);
  if (!response.ok || !response.headers.get('content-type')?.includes('json')) {
    console.error(`${name}: not found in the registry`);
    process.exitCode = 1;
    continue;
  }
  const item = await response.json();
  for (const dep of item.dependencies ?? []) dependencies.add(dep);
  for (const file of item.files ?? []) {
    const target = join(out, basename(file.path));
    await writeFile(target, file.content);
    console.log(`${name}: wrote ${basename(file.path)} (${file.content.length} chars)`);
  }
}
if (dependencies.size) console.log(`Needs: ${[...dependencies].join(', ')}`);
