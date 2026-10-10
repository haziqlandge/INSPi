import type { NextRequest } from 'next/server';
import { readSteer } from '@/lib/ai/prompts/steer';
import { readRun } from '@/lib/ai/run-choice';
import { PROVIDERS } from '@/lib/ai/registry';
import { crossOrigin, fail, ok } from '@/lib/http';
import { ensureWorker } from '@/lib/jobs/worker';
import { library } from '@/lib/store';

/**
 * Queues another analysis: a new version for a ready entry, or a fresh attempt for a failed one.
 * A retry may carry guidance, `{ focus: string[], note: string }`, which only applies to new versions,
 * and `run: { provider, vision?, text? }` to use another provider or models for this run only.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const { id } = await params;
  const lib = library();
  const entry = lib.getEntry(id);
  if (!entry) return fail(404, 'That entry does not exist.');
  if (entry.status === 'queued' || entry.status === 'analyzing') {
    return fail(409, 'This entry is already being analysed.');
  }

  const body: unknown = await request.json().catch(() => null);
  const run = readRun(body);
  if (run && 'error' in run) return fail(400, run.error);
  const steer = entry.versions.length ? readSteer(entry.mode, body) : null;
  const queued = lib.enqueueJob(entry.id, entry.versions.length ? 'retry' : 'analyze', steer, run);
  if (!queued) return fail(409, 'This entry is already being analysed.');
  lib.setProgress(entry.id, {
    status: 'queued',
    progress: `${steer ? 'Waiting its turn for a guided retry' : 'Waiting its turn'}${run ? ` on ${PROVIDERS[run.provider].label}` : ''}`,
    waitUntil: null,
    error: null,
  });
  ensureWorker();
  return ok(lib.getEntry(entry.id));
}
