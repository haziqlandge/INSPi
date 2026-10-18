import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { dirname, extname, isAbsolute, join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import sharp from 'sharp';
import { chatJson } from '../ai/client';
import { readChanges } from '../ai/prompts/steer';
import { chainFor, readRun } from '../ai/run-choice';
import type { Parsed } from '../ai/schema/wire';
import { composePrompt, readSubjectChoice } from '../copy/compose';
import { backendAvailable } from '../imagine/backends';
import { generateImage } from '../imagine/backends';
import { REMOVED_MESSAGE, removedImageModels } from '../imagine/removed';
import { runImagine } from '../imagine/run';
import { ImagineError, isBackendId, type BackendId } from '../imagine/types';
import { runJob } from '../jobs/worker';
import { ingestImage, UploadError } from '../media/ingest';
import { readSettings } from '../settings';
import type { Mode } from '../types';
import { envOf, ok, problem, str, type ToolContext, type ToolResult } from './context';
import { currentImageModel, findImageModel } from './models';
import { resolveReference } from './reference';

const FORMAT_FOR_EXTENSION: Record<string, 'png' | 'jpeg' | 'webp'> = { '.png': 'png', '.jpg': 'jpeg', '.jpeg': 'jpeg', '.webp': 'webp' };
const MAX_DOWNLOAD_BYTES = 20 * 1024 * 1024;

const sniffType = (bytes: Buffer) =>
  bytes[0] === 0x89 && bytes[1] === 0x50 ? 'png' : bytes[0] === 0xff && bytes[1] === 0xd8 ? 'jpeg' : bytes.subarray(8, 12).toString('ascii') === 'WEBP' ? 'webp' : null;

/**
 * Writes the model's own bytes where the caller asked. If the file name says another format than
 * the bytes are in, the picture is converted so the extension never lies.
 */
async function saveOriginal(path: string, bytes: Buffer): Promise<string> {
  const full = resolve(path);
  const wanted = FORMAT_FOR_EXTENSION[extname(full).toLowerCase()];
  const data = wanted && sniffType(bytes) !== wanted ? await sharp(bytes).toFormat(wanted).toBuffer() : bytes;
  await mkdir(dirname(full), { recursive: true });
  await writeFile(full, data);
  return full;
}

// ---------- generate_image ----------

export async function generateImageTool(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const prompt = str(args.prompt);
  if (!prompt) return problem('Write the prompt to draw first.');
  const env = envOf(ctx);

  // Which model and backend: the one named, else the saved pick (AutoPick resolves to a model now)
  let backend: BackendId;
  let model: string;
  const named = str(args.model);
  if (args.backend !== undefined && !isBackendId(args.backend)) return problem(`Unknown backend "${String(args.backend)}".`);
  if (named) {
    if (removedImageModels(ctx.lib).has(named)) return problem(REMOVED_MESSAGE);
    if (args.backend === 'keyless-url') {
      backend = 'keyless-url';
      model = named;
    } else {
      const only = args.backend as BackendId | undefined;
      if (only && !backendAvailable(only, env)) return problem('Add POLLINATIONS_API_KEY to .env and restart the server.');
      const found = await findImageModel(ctx, named, only);
      if (!found) {
        return problem(
          backendAvailable('pollinations', env)
            ? `No backend lists an image model "${named}". list_models kind "image" shows the ones available.`
            : 'Add POLLINATIONS_API_KEY to .env and restart the server.',
        );
      }
      backend = found.backend;
      model = named;
    }
  } else {
    const chosen = await currentImageModel(ctx).catch(() => null);
    if (!chosen) return problem('No healthy image model is available right now. list_models kind "image" shows the state.');
    backend = (args.backend as BackendId | undefined) ?? chosen.backend;
    model = chosen.model;
  }
  if (!backendAvailable(backend, env)) return problem('Add POLLINATIONS_API_KEY to .env and restart the server.');

  // A reference entry: its picture is shown to the model (only models that take one), and the render is filed under it
  let entryId: string | undefined;
  const referenceName = str(args.reference);
  if (referenceName) {
    const found = resolveReference(ctx.lib, referenceName);
    if ('error' in found) return problem(found.error);
    entryId = found.entry.id;
  }

  let raw: { bytes: Buffer; contentType: string } | null = null;
  const make = ctx.deps?.generate ?? ((b: BackendId, r: Parameters<typeof generateImage>[1]) => generateImage(b, r, env));
  try {
    const render = await runImagine(
      {
        backend,
        model,
        prompt,
        ...(str(args.negative) ? { negative: str(args.negative)!.slice(0, 1000) } : {}),
        ...(str(args.aspect) ? { aspect: str(args.aspect)!.slice(0, 12) } : {}),
        ...(typeof args.seed === 'number' && Number.isFinite(args.seed) ? { seed: Math.trunc(args.seed) } : {}),
        ...(entryId ? { entryId, reference: true } : {}),
      },
      {
        lib: ctx.lib,
        mediaRoot: ctx.mediaRoot,
        generate: async (b, r) => (raw = await make(b, r)),
      },
    );
    const lines = [`Generated ${render.width}×${render.height} with ${model} (${backend}).`];
    const saveTo = str(args.save_to);
    if (saveTo) {
      if (!isAbsolute(saveTo)) return problem('save_to must be an absolute path.');
      lines.push(`Saved: ${await saveOriginal(saveTo, (raw as unknown as { bytes: Buffer }).bytes)}`);
    }
    lines.push(`Kept in the library: ${ctx.baseUrl}/visualize${render.entrySlug ? ` (entry ${ctx.baseUrl}/e/${render.entrySlug})` : ''}`);
    const file = join(ctx.mediaRoot, render.entryId ?? '_playground', `${render.url.split('/').pop()}`);
    const preview = await readFile(file).catch(() => null);
    return {
      content: [{ type: 'text', text: lines.join('\n') }, ...(preview ? [{ type: 'image' as const, data: preview.toString('base64'), mimeType: 'image/webp' }] : [])],
    };
  } catch (error) {
    if (error instanceof ImagineError) return problem(error.message);
    return problem(error instanceof Error ? error.message : 'The image could not be made.');
  }
}

// ---------- write_prompt ----------

const KIND_NOTES: Record<string, string> = {
  image: 'A single picture. Say subject, setting, composition, light, colour and medium.',
  spritesheet:
    'A game sprite sheet: one character, a strict grid of equal cells (state columns and rows and the frame count), the same size and ground line in every cell, a flat solid background colour for keying out, no text or grid lines. Describe each frame in order, with animation principles (anticipation, squash and stretch, smear frames, overshoot, follow-through, clear silhouettes, arcs).',
  ui: 'A user-interface mock-up: the screen, its layout regions, the type and colour system, and the states shown.',
};

const SYSTEM = (kind: string) => `You write prompts for text-to-image models.
Turn the person's idea into one prompt a model can follow: concrete nouns, a clear composition, the style, and the light and colour. No preamble, no quotes, no markdown.
Keep every number the idea states exactly (frame count, grid, size, colours); never add more frames, rows or elements than it asks for.
${KIND_NOTES[kind] ?? KIND_NOTES.image}
Also give a short "negative" line: what to keep out of the picture.
Output only the JSON object.`;

const PROMPT_SCHEMA = {
  type: 'object',
  properties: { prompt: { type: 'string' }, negative: { type: 'string' } },
  required: ['prompt', 'negative'],
  additionalProperties: false,
};

function parsePrompt(raw: unknown): Parsed<{ prompt: string; negative: string }> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as { prompt?: unknown; negative?: unknown };
  if (typeof r.prompt !== 'string' || r.prompt.trim().length < 3) return { ok: false, issues: ['prompt: expected a sentence or more'] };
  return { ok: true, data: { prompt: r.prompt.trim(), negative: typeof r.negative === 'string' ? r.negative.trim() : '' } };
}

export async function writePromptTool(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const idea = str(args.idea);
  if (!idea) return problem('Say what the image should show.');
  const env = envOf(ctx);
  const kind = typeof args.kind === 'string' && args.kind in KIND_NOTES ? args.kind : 'image';

  const provider = str(args.provider);
  const run = readRun({ run: provider ? { provider, text: str(args.model) } : undefined }, env);
  if (run && 'error' in run) return problem(run.error);
  const setup = chainFor(run, readSettings(ctx.lib), env)[0];
  if (!setup) return problem('No text model is set up. Add an API key (GROQ_API_KEY, GEMINI_API_KEY…) to .env, then choose one with set_model kind "text".');

  // A reference entry lends its measured style
  let style = '';
  const referenceName = str(args.reference);
  if (referenceName) {
    const found = resolveReference(ctx.lib, referenceName);
    if ('error' in found) return problem(found.error);
    const active = found.entry.versions.find((v) => v.id === found.entry.activeVersionId);
    style = `\n\nMatch the visual style of the reference "${found.entry.name}": ${active?.note ?? ''} ${'prompt' in (active?.spec ?? {}) ? (active!.spec as { prompt?: string }).prompt ?? '' : ''}`.trimEnd();
  }

  const chat = ctx.deps?.chat ?? chatJson;
  try {
    const result = await chat({
      provider: setup.runtime,
      model: setup.text,
      system: SYSTEM(kind),
      user: `Idea: ${idea}${style}`,
      schema: { name: 'image_prompt', json: PROMPT_SCHEMA, shape: '{"prompt": "…", "negative": "…"}', parse: parsePrompt },
      maxTokens: 900,
      temperature: 0.7,
    });
    const { prompt, negative } = result.data;
    return ok(`Prompt (${setup.label}, ${setup.text.id}):\n${prompt}${negative ? `\n\nNegative: ${negative}` : ''}\n\nPass it to generate_image as prompt${negative ? ' and negative' : ''}.`);
  } catch (error) {
    return problem(`${setup.label} could not write the prompt: ${error instanceof Error ? error.message : 'it failed.'}`);
  }
}

// ---------- analyze_image ----------

async function readSource(source: string): Promise<Buffer> {
  if (/^https?:\/\//i.test(source)) {
    const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new UploadError(`The image could not be downloaded (${response.status}).`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > MAX_DOWNLOAD_BYTES) throw new UploadError('Images can be at most 20 MB each.');
    return bytes;
  }
  const data = /^data:[^;,]+;base64,([\s\S]*)$/.exec(source);
  if (data) return Buffer.from(data[1], 'base64');
  const path = resolve(source);
  const info = await stat(path).catch(() => null);
  if (!info?.isFile()) throw new UploadError(`No file at ${path}.`);
  return readFile(path);
}

async function waitForAnalysis(ctx: ToolContext, entryId: string): Promise<void> {
  // The web app's worker took the job: wait for it to finish, up to ten minutes
  for (let i = 0; i < 300; i++) {
    const status = ctx.lib.getEntry(entryId)?.status;
    if (status === 'ready' || status === 'failed') return;
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }
}

async function defaultAnalyze(ctx: ToolContext, entryId: string): Promise<void> {
  for (;;) {
    const job = ctx.lib.takeJob();
    if (!job) break;
    await runJob(job, ctx.lib);
    if (job.entryId === entryId) return;
  }
  await waitForAnalysis(ctx, entryId);
}

export async function analyzeImageTool(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const source = str(args.source);
  if (!source) return problem('Give the image: an absolute file path, an http(s) address or a data URI.');
  const mode: Mode = args.mode === 'web' ? 'web' : 'image';
  const env = envOf(ctx);
  const provider = str(args.provider);
  const run = readRun({ run: provider ? { provider, vision: str(args.vision_model), text: str(args.text_model) } : undefined }, env);
  if (run && 'error' in run) return problem(run.error);
  if (!ctx.deps?.analyze && !chainFor(run, readSettings(ctx.lib), env).length) {
    return problem('No AI provider is set up. Add an API key to .env, then choose models with set_model kind "text".');
  }

  const id = nanoid(12);
  const dir = join(ctx.mediaRoot, id);
  let image;
  try {
    image = await ingestImage(await readSource(source), dir);
  } catch (error) {
    return problem(error instanceof UploadError ? error.message : `The image could not be read: ${error instanceof Error ? error.message : 'unknown error'}`);
  }
  const entry = ctx.lib.createEntry({ id, mode, compress: false, images: [image] });
  const subject = mode === 'image' ? readSubjectChoice(args.subject, args.subject_text) : null;
  ctx.lib.enqueueJob(entry.id, 'analyze', null, run && !('error' in run) ? run : null, { changes: readChanges(args.changes), subject });

  try {
    await (ctx.deps?.analyze ? ctx.deps.analyze(ctx.lib, entry.id) : defaultAnalyze(ctx, entry.id));
  } catch (error) {
    return problem(`The analysis failed: ${error instanceof Error ? error.message : 'unknown error'}`);
  }

  const done = ctx.lib.getEntry(entry.id);
  const active = done?.versions.find((v) => v.id === done.activeVersionId);
  if (!done || !active) return problem(`The analysis did not finish${done?.error ? `: ${done.error}` : ''}. The entry is at ${ctx.baseUrl}/e/${entry.slug}.`);
  return ok(`Analysed as "${done.name}" (${done.category}), kept at ${ctx.baseUrl}/e/${done.slug}. Prompt:\n\n${composePrompt(active.spec)}`);
}
