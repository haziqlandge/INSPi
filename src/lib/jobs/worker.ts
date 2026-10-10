import { rm } from 'node:fs/promises';
import { lensForRetry } from '../ai/prompts/steer';
import { chainFor } from '../ai/run-choice';
import { collectionChoices } from '../library/collections';
import { analyze } from '../ai/strategy';
import { buildFrames } from '../media/collage';
import { backfillPalettes } from '../media/entry-palette';
import { packFrames } from '../media/pack';
import { entryMediaDir } from '../paths';
import { readSettings } from '../settings';
import { library } from '../store';
import type { Job } from '../store/library';

/** Older entries get their measured palette a few at a time while the queue is idle. */
const PALETTES_PER_IDLE_TICK = 5;
/** Deleted entries can be restored for this long before their files are removed. */
const UNDO_WINDOW_MS = 10 * 60_000;
const IDLE_POLL_MS = 15_000;
const FIRST_TEMPERATURE = 0.4;
const RETRY_TEMPERATURE = 0.8;

interface WorkerState {
  /** Which evaluation of this module started the loop. */
  code: symbol;
  wake: () => void;
  /** Stops taking new jobs; resolves once the job in hand (if any) is finished. */
  retire: () => Promise<void>;
}

// A fresh symbol each time the dev server re-evaluates this file after an edit.
const CODE = Symbol('inspi worker code');

// `retire` is optional because a server started before hand-over existed has a worker without it.
const globals = globalThis as { __inspiWorker?: Omit<WorkerState, 'retire' | 'code'> & Partial<WorkerState> };

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
    const steer = isRetry ? job.steer : null;
    const lens = lensForRetry(entry.mode, versionNumber, steer);

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
        steer,
        changes: job.changes || active?.spec.changes || undefined,
        // A retry keeps the entry's subject choice
        subject: job.subject ?? (active?.spec.inspi === 'image/1' && active.spec.subjectMode ? { mode: active.spec.subjectMode, text: active.spec.mySubject } : null),
      },
      {
        // One provider only: the one this run asked for, else the one in use. A failure is reported as it is.
        chain: chainFor(job.run, settings),
        onProgress: (p) => lib.setProgress(entry.id, { progress: p.text, waitUntil: p.waitUntil }),
        onCall: (call) => lib.recordCall({ ...call, entryId: entry.id }),
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
        steer,
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

interface LoopState {
  sleeping: (() => void) | null;
  retired: boolean;
}

async function loop(state: LoopState, previous: Promise<void>): Promise<void> {
  // Never run beside an older loop: it could be halfway through a job that requeueing would repeat.
  await previous;
  if (state.retired) return;
  const lib = library();
  lib.requeueRunningJobs();
  while (!state.retired) {
    const job = lib.takeJob();
    if (job) {
      await runJob(job).catch((error) => console.error('[inspi] job crashed', error));
      continue;
    }
    await purge().catch(() => {});
    await backfillPalettes(lib, PALETTES_PER_IDLE_TICK).catch((error) => console.error('[inspi] palette backfill', error));
    if (state.retired) break;
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

function start(previous: Promise<void>): WorkerState {
  const state: LoopState = { sleeping: null, retired: false };
  const stopped = loop(state, previous).catch((error) => console.error('[inspi] worker stopped', error));
  return {
    code: CODE,
    wake: () => state.sleeping?.(),
    retire: () => {
      state.retired = true;
      state.sleeping?.();
      return stopped;
    },
  };
}

/**
 * Starts the single background worker for this server process and nudges it awake. After the dev
 * server reloads this code, the next call hands over: the old loop finishes its current job and
 * stops, and a loop running the new code takes the queue from there.
 */
export function ensureWorker(): void {
  const current = globals.__inspiWorker;
  if (current && (current.code === CODE || !current.retire)) {
    current.wake();
    return;
  }
  const next = start(current?.retire?.() ?? Promise.resolve());
  globals.__inspiWorker = next;
  next.wake();
}
