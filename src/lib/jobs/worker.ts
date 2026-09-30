import { rm } from 'node:fs/promises';
import { lensForVersion } from '../ai/prompts/lenses';
import { providerChain } from '../ai/registry';
import { collectionChoices } from '../library/collections';
import { analyze } from '../ai/strategy';
import { buildFrames } from '../media/collage';
import { packFrames } from '../media/pack';
import { entryMediaDir } from '../paths';
import { readSettings } from '../settings';
import { library } from '../store';
import type { Job } from '../store/library';

/** Deleted entries can be restored for this long before their files are removed. */
const UNDO_WINDOW_MS = 10 * 60_000;
const IDLE_POLL_MS = 15_000;
const FIRST_TEMPERATURE = 0.4;
const RETRY_TEMPERATURE = 0.8;

interface WorkerState {
  wake: () => void;
}

const globals = globalThis as { __inspiWorker?: WorkerState };

async function purge(): Promise<void> {
  for (const id of library().purgeDeleted(UNDO_WINDOW_MS)) {
    await rm(entryMediaDir(id), { recursive: true, force: true }).catch(() => {});
  }
}

async function runJob(job: Job): Promise<void> {
  const lib = library();
  const entry = lib.getEntry(job.entryId);
  if (!entry) {
    lib.finishJob(job.id, 'failed', 'Entry was deleted.');
    return;
  }

  const started = Date.now();
  const isRetry = entry.versions.length > 0;
  lib.setProgress(entry.id, { status: 'analyzing', progress: 'Preparing the images', waitUntil: null, error: null });

  try {
    const groups = packFrames(entry.images.length, entry.compress);
    const frames = await buildFrames(entryMediaDir(entry.id), entry.images, groups);
    const settings = readSettings(lib);
    const versionNumber = entry.versions.length + 1;
    const active = entry.versions.find((v) => v.id === entry.activeVersionId);
    const lens = lensForVersion(versionNumber);

    const result = await analyze(
      {
        mode: entry.mode,
        frames,
        lens,
        knownTags: lib.topTags(60).map((t) => t.name),
        collections: collectionChoices(lib.collectionNames()),
        temperature: isRetry ? RETRY_TEMPERATURE : FIRST_TEMPERATURE,
        identity: isRetry ? { name: entry.name, category: entry.category, tags: entry.tags } : undefined,
        previousSignature: isRetry ? active?.spec.signature : undefined,
      },
      {
        // Only the provider in use is tried. If it fails, the analysis fails and says why.
        chain: providerChain(settings.order, settings.models).slice(0, 1),
        onProgress: (p) => lib.setProgress(entry.id, { progress: p.text, waitUntil: p.waitUntil }),
      },
    );

    lib.applyAnalysis(entry.id, {
      identity: result.identity,
      collections: result.collections,
      version: {
        lens: lens.id,
        note: result.note,
        spec: result.spec,
        provider: result.provider,
        model: result.model,
        tokensIn: result.usage.input,
        tokensOut: result.usage.output,
        durationMs: Date.now() - started,
      },
    });
    lib.finishJob(job.id, 'done');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'The analysis failed.';
    // A failed retry leaves the entry usable with the versions it already has.
    lib.setProgress(entry.id, { status: isRetry ? 'ready' : 'failed', progress: null, waitUntil: null, error: message });
    lib.finishJob(job.id, 'failed', message);
  }
}

async function loop(state: { sleeping: (() => void) | null }): Promise<void> {
  const lib = library();
  lib.requeueRunningJobs();
  for (;;) {
    const job = lib.takeJob();
    if (job) {
      await runJob(job).catch((error) => console.error('[inspi] job crashed', error));
      continue;
    }
    await purge().catch(() => {});
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, IDLE_POLL_MS);
      state.sleeping = () => {
        clearTimeout(timer);
        resolve();
      };
    });
    state.sleeping = null;
  }
}

/** Starts the single background worker for this server process (idempotent) and nudges it awake. */
export function ensureWorker(): void {
  if (!globals.__inspiWorker) {
    const state: { sleeping: (() => void) | null } = { sleeping: null };
    globals.__inspiWorker = { wake: () => state.sleeping?.() };
    void loop(state);
  }
  globals.__inspiWorker.wake();
}
