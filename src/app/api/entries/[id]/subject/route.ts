import type { NextRequest } from 'next/server';
import { ProviderError } from '@/lib/ai/client';
import { describeSubject } from '@/lib/ai/describe';
import { chainFor } from '@/lib/ai/run-choice';
import { crossOrigin, fail, ok } from '@/lib/http';
import { buildFrames } from '@/lib/media/collage';
import { entryMediaDir } from '@/lib/paths';
import { readSettings } from '@/lib/settings';
import { readSubjectChoice } from '@/lib/copy/compose';
import { library } from '@/lib/store';

/**
 * Describes what an image entry's first picture shows and keeps it on the version, for Visualize's
 * "Recreate it". Body: `{ versionId }`. One vision call with the provider in use; nothing else is tried.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const { id } = await params;
  const lib = library();
  const entry = lib.getEntry(id);
  if (!entry) return fail(404, 'That entry does not exist.');
  const body = (await request.json().catch(() => null)) as { versionId?: unknown } | null;
  const version = entry.versions.find((v) => v.id === body?.versionId);
  if (!version || version.spec.inspi !== 'image/1') return fail(400, 'Only an image entry’s version can be described.');
  if (!entry.images.length) return fail(400, 'This entry has no images.');

  const setup = chainFor(null, readSettings(lib))[0];
  if (!setup) return fail(400, 'No analysis provider is set up. Add a key in .env and pick a reading model in Settings.');

  const [frame] = await buildFrames(entryMediaDir(entry.id), entry.images, [[0]]);
  const call = { provider: setup.runtime.id, model: setup.vision.id, step: 'observe' as const, entryId: entry.id };
  try {
    const { subject, usage } = await describeSubject(frame.dataUrl, setup);
    lib.recordCall({ ...call, at: Date.now(), tokensIn: usage.input, tokensOut: usage.output, ok: true, error: null });
    lib.setVersionSubject(version.id, subject);
    return ok({ subject });
  } catch (error) {
    const kind = error instanceof ProviderError ? error.kind : 'server';
    lib.recordCall({ ...call, at: Date.now(), tokensIn: 0, tokensOut: 0, ok: false, error: kind });
    return fail(502, `${setup.label} could not describe it: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
}

/**
 * Changes which prompt an image version gives by default (Copy prompt, Visualize).
 * Body: `{ versionId, mode: 'recreate' | 'mine' | 'model', text? }` (text is the subject for "mine").
 */
export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;
  const { id } = await params;
  const lib = library();
  const entry = lib.getEntry(id);
  if (!entry) return fail(404, 'That entry does not exist.');
  const body = (await request.json().catch(() => null)) as { versionId?: unknown; mode?: unknown; text?: unknown } | null;
  const version = entry.versions.find((v) => v.id === body?.versionId);
  if (!version || version.spec.inspi !== 'image/1') return fail(400, 'Only an image entry’s version has a subject choice.');
  const choice = readSubjectChoice(body?.mode, body?.text);
  if (!choice) return fail(400, body?.mode === 'mine' ? 'Write your subject first.' : 'Unknown subject choice.');
  lib.setVersionSubjectMode(version.id, choice.mode, choice.text);
  return ok({ entry: lib.getEntry(id) });
}
