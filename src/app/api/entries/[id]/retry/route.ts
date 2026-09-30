import type { NextRequest } from 'next/server';
import { crossOrigin, fail, ok } from '@/lib/http';
import { ensureWorker } from '@/lib/jobs/worker';
import { library } from '@/lib/store';

/** Queues another analysis: a new version for a ready entry, or a fresh attempt for a failed one. */
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

  const queued = lib.enqueueJob(entry.id, entry.versions.length ? 'retry' : 'analyze');
  if (!queued) return fail(409, 'This entry is already being analysed.');
  lib.setProgress(entry.id, { status: 'queued', progress: 'Waiting its turn', waitUntil: null, error: null });
  ensureWorker();
  return ok(lib.getEntry(entry.id));
}
