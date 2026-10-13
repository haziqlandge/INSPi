import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { entryMediaDir } from '../paths';
import { library } from '../store';
import { PLAYGROUND_DIR, type Library } from '../store/library';
import type { Render } from '../types';
import { generateImage } from './backends';
import { sizeFor } from './size';
import { ImagineError, isBackendId, type BackendId, type ImagineRequest } from './types';

export interface ImagineInput {
  backend: BackendId;
  model: string;
  prompt: string;
  negative?: string;
  /** Aspect ratio such as "3:2"; a square when missing. */
  aspect?: string;
  seed?: number;
  entryId?: string;
  versionId?: string;
  /** Show the model the entry's first picture too (models that take an image only). */
  reference?: boolean;
}

const MAX_PROMPT = 32_000;
/** Model ids are short and never contain whitespace. */
export const MODEL_ID = /^[^\s]{1,120}$/;
const ID = /^[A-Za-z0-9_-]{1,40}$/;

/** Checks a request from the browser; the error is a sentence to show as it is. */
export function readImagineBody(body: unknown): ImagineInput | { error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  if (!isBackendId(b.backend)) return { error: 'Unknown image backend.' };
  const model = typeof b.model === 'string' ? b.model.trim() : '';
  if (!MODEL_ID.test(model)) return { error: 'Pick a model.' };
  const prompt = typeof b.prompt === 'string' ? b.prompt.trim() : '';
  if (!prompt) return { error: 'Write a prompt first.' };
  if (prompt.length > MAX_PROMPT) return { error: 'The prompt is longer than 32,000 characters.' };
  // A `seed` from an older page is ignored: Visualize has none since 5 Oct 2026
  const input: ImagineInput = { backend: b.backend, model, prompt };
  if (typeof b.negative === 'string' && b.negative.trim()) input.negative = b.negative.trim().slice(0, 1000);
  if (typeof b.aspect === 'string' && b.aspect.trim()) input.aspect = b.aspect.trim().slice(0, 12);
  if (typeof b.entryId === 'string' && ID.test(b.entryId)) input.entryId = b.entryId;
  if (typeof b.versionId === 'string' && ID.test(b.versionId)) input.versionId = b.versionId;
  if (b.reference === true) {
    if (!input.entryId) return { error: 'A reference picture needs an entry.' };
    if (input.backend === 'keyless-url') return { error: 'The keyless route cannot be shown a reference image.' };
    input.reference = true;
  }
  return input;
}

/** The entry's first picture as a JPEG data URI, at most 1024 px on its long side. */
async function referenceImage(lib: Library, entryId: string): Promise<string> {
  const entry = lib.getEntry(entryId);
  const first = entry?.images[0];
  if (!first) throw new ImagineError('server', 'That entry has no picture to show the model.');
  // sharp gets the bytes, not the path: on Windows it can hold the file open and block deleting the entry.
  const jpeg = await sharp(await readFile(join(entryMediaDir(entryId), `${first.id}.webp`)))
    .resize({ width: 1024, height: 1024, fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 88 })
    .toBuffer();
  return `data:image/jpeg;base64,${jpeg.toString('base64')}`;
}

/**
 * The aspect the person picked wins over whatever the prompt says. A spec's JSON carries its own
 * "aspect_ratio" (often 4:3 or 3:2), and models follow the words over the pixel size, so a 16:9 pick
 * came back as 4:3. The JSON value is rewritten and a plain line leads the prompt.
 */
export function withAspect(prompt: string, aspect: string | undefined, size: { width: number; height: number }): string {
  const match = /^\s*(\d+(?:\.\d+)?)\s*[:x/]\s*(\d+(?:\.\d+)?)\s*$/i.exec(aspect ?? '');
  if (!match) return prompt;
  const ratio = `${match[1]}:${match[2]}`;
  const rewritten = prompt.replace(/("aspect_ratio"\s*:\s*")[^"]*(")/g, `$1${ratio}$2`);
  return `Aspect ratio: ${ratio} (${size.width}×${size.height} px). Compose the whole picture for this frame; it overrides any other aspect ratio, format or crop mentioned below.\n\n${rewritten}`;
}

interface Deps {
  lib?: Library;
  /** Reads the reference picture; replaced in tests. */
  reference?: (lib: Library, entryId: string) => Promise<string>;
  generate?: (backend: BackendId, req: ImagineRequest) => Promise<{ bytes: Buffer; contentType: string }>;
}

/**
 * Makes one image with the backend and model given, keeps it as WebP in the entry's media folder
 * (or the playground's) and records the request for the Usage page. Nothing else is tried if it fails.
 */
export async function runImagine(input: ImagineInput, deps: Deps = {}): Promise<Render> {
  const lib = deps.lib ?? library();
  const generate = deps.generate ?? ((backend, req) => generateImage(backend, req));
  const { width, height } = sizeFor(input.aspect);
  const request: ImagineRequest = { prompt: withAspect(input.prompt, input.aspect, { width, height }), negative: input.negative, width, height, seed: input.seed, model: input.model };
  if (input.reference && input.entryId) request.image = await (deps.reference ?? referenceImage)(lib, input.entryId);
  const call = { provider: 'pollinations', model: input.model, step: 'imagine' as const, entryId: input.entryId ?? null, tokensIn: 0, tokensOut: 0 };

  let image: { bytes: Buffer; contentType: string };
  try {
    image = await generate(input.backend, request);
  } catch (error) {
    // A server error keeps its HTTP status, so the removal rule (removed.ts) counts only real 5xx
    // answers; anything that failed here, before or after Pollinations, is `internal`.
    const kind =
      error instanceof ImagineError ? (error.kind !== 'server' ? error.kind : error.status ? `server:${error.status}` : 'internal') : 'internal';
    lib.recordCall({ ...call, at: Date.now(), ok: false, error: kind });
    throw error;
  }
  lib.recordCall({ ...call, at: Date.now(), ok: true });

  const folder = entryMediaDir(input.entryId ?? PLAYGROUND_DIR);
  const file = `render-${nanoid(12)}.webp`;
  const path = join(folder, file);
  await mkdir(folder, { recursive: true });
  const webp = await sharp(image.bytes).webp({ quality: 90 }).toBuffer();
  await writeFile(path, webp);

  const render = lib.addRender({
    entryId: input.entryId ?? null,
    versionId: input.versionId ?? null,
    backend: input.backend,
    model: input.model,
    prompt: input.prompt,
    seed: input.seed ?? null,
    width,
    height,
    file,
  });
  if (!render) {
    await rm(path, { force: true });
    throw new Error('That entry was deleted.');
  }
  return render;
}
