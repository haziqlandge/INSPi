import { rm } from 'node:fs/promises';
import { nanoid } from 'nanoid';
import type { NextRequest } from 'next/server';
import { crossOrigin, fail, ok } from '@/lib/http';
import { ensureWorker } from '@/lib/jobs/worker';
import { ingestImage, UploadError } from '@/lib/media/ingest';
import { MAX_IMAGES_COMPRESSED, MAX_IMAGES_PLAIN, packFrames } from '@/lib/media/pack';
import { entryMediaDir } from '@/lib/paths';
import { library } from '@/lib/store';
import type { NewImage } from '@/lib/store/library';
import { paletteForEntry } from '@/lib/media/entry-palette';
import { readChanges } from '@/lib/ai/prompts/steer';
import { readSubjectChoice } from '@/lib/copy/compose';
import { readRun } from '@/lib/ai/run-choice';

export async function GET(request: NextRequest) {
  ensureWorker();
  const p = request.nextUrl.searchParams;
  const mode = p.get('mode');
  const lib = library();
  const result = lib.listEntries({
    q: p.get('q') ?? undefined,
    category: p.get('category') ?? undefined,
    tag: p.get('tag') ?? undefined,
    mode: mode === 'web' || mode === 'image' ? mode : undefined,
    favorite: p.get('fav') === '1',
    collectionId: p.get('collection') ?? undefined,
    limit: Number(p.get('limit')) || undefined,
    offset: Number(p.get('offset')) || undefined,
  });
  return ok({ ...result, categories: lib.categoryCounts() });
}

export async function POST(request: NextRequest) {
  const blocked = crossOrigin(request);
  if (blocked) return blocked;

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, 'The upload could not be read.');
  }

  const files = form.getAll('files').filter((f): f is File => f instanceof File && f.size > 0);
  const mode = form.get('mode') === 'image' ? 'image' : 'web';
  const compress = form.get('compress') === '1';

  if (files.length === 0) return fail(400, 'Add at least one image.');
  // Optional: the provider and models for this one analysis, as JSON { provider, vision?, text? }
  const runField = form.get('run');
  let run: ReturnType<typeof readRun> = null;
  if (typeof runField === 'string' && runField.trim()) {
    let parsed: unknown = null;
    try {
      parsed = JSON.parse(runField);
    } catch {
      return fail(400, 'The provider choice could not be read.');
    }
    run = readRun({ run: parsed });
    if (run && 'error' in run) return fail(400, run.error);
  }
  try {
    packFrames(files.length, compress);
  } catch {
    return fail(
      400,
      compress
        ? `An entry can hold at most ${MAX_IMAGES_COMPRESSED} images.`
        : `More than ${MAX_IMAGES_PLAIN} images need Compress turned on.`,
    );
  }

  const id = nanoid(12);
  const dir = entryMediaDir(id);
  const images: NewImage[] = [];
  try {
    for (const file of files) {
      images.push(await ingestImage(Buffer.from(await file.arrayBuffer()), dir));
    }
  } catch (error) {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    if (error instanceof UploadError) return fail(400, error.message);
    console.error('[inspi] upload failed', error);
    return fail(500, 'The images could not be saved.');
  }

  const lib = library();
  const entry = lib.createEntry({ id, mode, compress, images });
  // Measured locally in a few milliseconds; no AI involved.
  lib.setPalette(entry.id, await paletteForEntry(entry.id, images.map((image) => image.id)));
  // Tweaks the person wants from the reference, applied when the prompt is written
  // Image entries: whether the prompt recreates the picture, uses the person's subject, or only the style
  const subject = mode === 'image' ? readSubjectChoice(form.get('subject'), form.get('subjectText')) : null;
  lib.enqueueJob(entry.id, 'analyze', null, run, { changes: readChanges(form.get('changes')), subject });
  ensureWorker();
  return ok({ id: entry.id, slug: entry.slug }, { status: 201 });
}
