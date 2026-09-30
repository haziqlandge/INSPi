/**
 * Analyse images from the command line, without the app or the database.
 *
 *   npm run analyze -- path/to/image.png [more images] [--mode web|image] [--compress] [--version 2] [--out file.json]
 *
 * Prints the spec, and for each model call how the token estimate compared with what the provider counted.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chatJson, type ChatRequest } from '../src/lib/ai/client';
import { estimateTokens } from '../src/lib/ai/budget';
import { lensForVersion } from '../src/lib/ai/prompts/lenses';
import { PROVIDER_IDS, providerChain } from '../src/lib/ai/registry';
import { analyze } from '../src/lib/ai/strategy';
import { composePrompt } from '../src/lib/copy/compose';
import { buildFrames } from '../src/lib/media/collage';
import { ingestImage } from '../src/lib/media/ingest';
import { packFrames } from '../src/lib/media/pack';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env: rely on the environment
}

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i > -1 ? args[i + 1] : undefined;
};
const files = args.filter((a, i) => !a.startsWith('--') && !['--mode', '--version', '--out', '--provider'].includes(args[i - 1]));
const mode = flag('mode') === 'image' ? 'image' : 'web';
const compress = args.includes('--compress');
const version = Number(flag('version') ?? 1);
const out = flag('out');

if (files.length === 0) {
  console.error('Usage: npm run analyze -- <image> [more images] [--mode web|image] [--compress] [--version N] [--out file.json]');
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), 'inspi-analyze-'));

async function main() {
  const images = [];
  for (const file of files) images.push(await ingestImage(readFileSync(file), dir));
  const frames = await buildFrames(dir, images, packFrames(images.length, compress));

  // Like the app, only one provider is used: the first with a key, or the one named by --provider.
  const wanted = flag('provider');
  const chain = providerChain(PROVIDER_IDS.filter((id) => !wanted || id === wanted)).slice(0, 1);
  console.error(`Providers with keys: ${chain.map((c) => `${c.label} (${c.vision.id})`).join(', ') || 'none'}`);
  console.error(`Frames: ${frames.map((f) => `${f.images} image${f.images > 1 ? 's' : ''}, ${Math.round(f.dataUrl.length / 1024)} KB`).join(' | ')}`);

  const started = Date.now();
  const result = await analyze(
    { mode, frames, lens: lensForVersion(version), knownTags: [], temperature: version > 1 ? 0.8 : 0.4 },
    {
      chain,
      onProgress: (p) => console.error(`  ${p.text}${p.waitUntil ? ` (${Math.ceil((p.waitUntil - Date.now()) / 1000)}s)` : ''}`),
      chat: async <T,>(req: ChatRequest<T>) => {
        const estimate = estimateTokens(req.system + req.user) + (req.images?.length ?? 0) * 2048;
        const reply = await chatJson(req);
        console.error(
          `  ${req.model.id}: estimated ${estimate} in, counted ${reply.usage.input} in / ${reply.usage.output} out (asked for up to ${req.maxTokens}); tokens left this minute: ${reply.rate.remainingTokens ?? '?'}`,
        );
        return reply;
      },
    },
  );

  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  console.error(`Done in ${seconds}s with ${result.provider}: ${result.calls} calls, ${result.usage.input} in / ${result.usage.output} out.`);
  const text = composePrompt(result.spec);
  if (out) {
    writeFileSync(out, text);
    console.error(`Wrote ${out}`);
  } else {
    console.log(text);
  }
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(() => {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // temp files are cleaned up by the OS
    }
  });
