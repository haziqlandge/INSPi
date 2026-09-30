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
  lib.enqueueJob(entry.id, 'analyze');
  ensureWorker();
  return ok({ id: entry.id, slug: entry.slug }, { status: 201 });
}
