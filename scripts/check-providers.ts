/**
 * For every provider with a key in .env, asks which models that key can use and reports whether
 * the configured model ids are still among them. Costs no tokens.
 *
 *   npm run check-providers
 */
import { listModels } from '../src/lib/ai/status';
import { hasKeys, PROVIDER_IDS, PROVIDERS } from '../src/lib/ai/registry';

try {
  process.loadEnvFile('.env');
} catch {
  // no .env: rely on the environment
}

async function main() {
  for (const id of PROVIDER_IDS) {
    const spec = PROVIDERS[id];
    console.log(`\n${spec.label}`);
    if (!hasKeys(id)) {
      console.log(`  no key (${spec.keyEnv.join(', ')}). Get one at ${spec.keyUrl}`);
      continue;
    }
    const listing = await listModels(id);
    console.log(`  ${listing.message}`);
    if (!listing.ok) continue;

    for (const [role, model] of [
      ['reads images', spec.vision.id],
      ['writes the spec', spec.text.id],
    ] as const) {
      if (!model) {
        console.log(`  ${role}: no default model. Choose one in Settings.`);
      } else if (listing.models.some((m) => m.id === model)) {
        console.log(`  ${role}: ${model} is available`);
      } else {
        console.log(`  ${role}: ${model} is NOT in the list. It may have been retired; update src/lib/ai/registry.ts or Settings.`);
      }
    }

    const vision = listing.models.filter((m) => m.vision === true && m.free !== false);
    if (vision.length) {
      console.log(`  free models that read images: ${vision.slice(0, 12).map((m) => m.id).join(', ')}${vision.length > 12 ? ', …' : ''}`);
    }
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
