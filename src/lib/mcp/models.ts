import type { ProviderId } from '../ai/client';
import { hasKeys, PROVIDERS } from '../ai/registry';
import { isProviderId, listModels, type ListedModel } from '../ai/status';
import { BACKEND_LABELS, backendAvailable } from '../imagine/backends';
import { imageModels } from '../imagine/catalog';
import { AUTO_MODES, recommendModel, type AutoMode } from '../imagine/recommend';
import { REMOVED_MESSAGE, removedImageModels } from '../imagine/removed';
import { BACKEND_IDS, isBackendId, type BackendId, type ImageModel } from '../imagine/types';
import { readSettings, writeSettings } from '../settings';
import { envOf, ok, problem, str, type ToolContext, type ToolResult } from './context';

const DAY_MS = 86_400_000;
/** A listing this long stops helping; the rest is reachable with `search` or `provider`. */
const TEXT_LIST_LIMIT = 40;

/** One backend's models, less the removed ones. Fails soft: a backend that cannot be read lists nothing. */
export async function imageModelsOf(ctx: ToolContext, backend: BackendId): Promise<ImageModel[]> {
  if (ctx.deps?.imageModels) return ctx.deps.imageModels(backend);
  return imageModels(backend, fetch, removedImageModels(ctx.lib));
}

/** Where a model id can be generated: the backend that lists it. */
export async function findImageModel(ctx: ToolContext, model: string, only?: BackendId): Promise<{ backend: BackendId; model: ImageModel } | null> {
  for (const backend of only ? [only] : BACKEND_IDS) {
    if (!backendAvailable(backend, envOf(ctx))) continue;
    const found = (await imageModelsOf(ctx, backend).catch(() => [])).find((m) => m.id === model);
    if (found) return { backend, model: found };
  }
  return null;
}

/** The image model a request with none named would use: the saved pick, or AutoPick's choice right now. */
export async function currentImageModel(ctx: ToolContext): Promise<{ backend: BackendId; model: string; auto: AutoMode | false } | null> {
  const choice = readSettings(ctx.lib).imagine;
  if (!choice.auto) return { backend: choice.backend, model: choice.model, auto: false };
  const official = await imageModelsOf(ctx, 'pollinations').catch(() => []);
  const failing = new Set(ctx.lib.failingImageModels(Date.now() - DAY_MS));
  const model = recommendModel(official, failing, choice.auto);
  return model ? { backend: 'pollinations', model, auto: choice.auto } : null;
}

const modelLine = (m: ImageModel, current: boolean) =>
  `- ${m.id} — ${m.label} · ${m.health}${m.successRate !== null ? ` ${m.successRate}%` : ''}${m.acceptsImage ? ' · takes a reference image' : ''}${current ? '  ← current' : ''}`;

async function imageSection(ctx: ToolContext, search: string | undefined): Promise<string> {
  const env = envOf(ctx);
  const settings = readSettings(ctx.lib);
  const now = await currentImageModel(ctx).catch(() => null);
  const lines = [
    'IMAGE MODELS — these make pictures (generate_image; pick one with set_model kind "image")',
    settings.imagine.auto
      ? `Choice: AutoPick "${settings.imagine.auto}"${now ? `, which is ${now.model} right now` : ''}. Modes: ${AUTO_MODES.join(', ')}.`
      : `Choice: ${settings.imagine.model} on ${BACKEND_LABELS[settings.imagine.backend]}.`,
  ];
  for (const backend of BACKEND_IDS) {
    if (!backendAvailable(backend, env)) {
      lines.push('', `${BACKEND_LABELS[backend]}: needs POLLINATIONS_API_KEY in .env.`);
      continue;
    }
    let models: ImageModel[];
    try {
      models = await imageModelsOf(ctx, backend);
    } catch (error) {
      lines.push('', `${BACKEND_LABELS[backend]}: ${error instanceof Error ? error.message : 'the list could not be read.'}`);
      continue;
    }
    if (search) models = models.filter((m) => `${m.id} ${m.label}`.toLowerCase().includes(search.toLowerCase()));
    lines.push('', `${BACKEND_LABELS[backend]} (backend "${backend}", ${models.length} models):`);
    lines.push(...models.map((m) => modelLine(m, now?.backend === backend && now.model === m.id)));
  }
  return lines.join('\n');
}

const visionFirst = (a: ListedModel, b: ListedModel) => Number(b.vision === true) - Number(a.vision === true) || a.id.localeCompare(b.id);

async function textSection(ctx: ToolContext, search: string | undefined, only: ProviderId | undefined): Promise<string> {
  const env = envOf(ctx);
  const settings = readSettings(ctx.lib);
  const lines = [
    'TEXT MODELS — these read images and write text (analyze_image, write_prompt; pick with set_model kind "text")',
    'They never make pictures. A provider has a vision model (reads images) and a text model (writes the prompt).',
  ];
  for (const id of settings.order) {
    if (only && id !== only) continue;
    const spec = PROVIDERS[id];
    if (!hasKeys(id, env)) {
      lines.push('', `${spec.label} (${id}): needs ${spec.keyEnv.join(' and ')} in .env.`);
      continue;
    }
    const vision = settings.models[id]?.vision || spec.vision.id;
    const text = settings.models[id]?.text || spec.text.id || vision;
    const inUse = settings.order.find((p) => hasKeys(p, env)) === id;
    lines.push('', `${spec.label} (${id})${inUse ? '  ← current provider' : ''}: vision ${vision || 'not chosen'}, text ${text || 'not chosen'}`);
    const listing = await (ctx.deps?.textModels ?? ((p: ProviderId) => listModels(p, env)))(id).catch(() => null);
    if (!listing?.ok) {
      lines.push(`  ${listing?.message ?? 'The model list could not be read.'}`);
      continue;
    }
    let models = [...listing.models].sort(visionFirst);
    if (search) models = models.filter((m) => m.id.toLowerCase().includes(search.toLowerCase()));
    const shown = models.slice(0, TEXT_LIST_LIMIT);
    for (const m of shown) {
      const tags = [m.vision === true ? 'vision' : m.vision === false ? 'text only' : 'vision unknown', m.free ? 'free' : '', m.health ?? ''].filter(Boolean).join(' · ');
      lines.push(`  - ${m.id} — ${tags}${m.id === vision || m.id === text ? '  ← current' : ''}`);
    }
    if (models.length > shown.length) lines.push(`  … ${models.length - shown.length} more; narrow with search.`);
  }
  return lines.join('\n');
}

export async function listModelsTool(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const kind = args.kind === undefined ? 'all' : args.kind;
  if (kind !== 'all' && kind !== 'image' && kind !== 'text') return problem('kind is "image", "text" or "all".');
  const search = str(args.search);
  const provider = str(args.provider);
  if (provider && !isProviderId(provider)) return problem(`Unknown provider "${provider}". Providers: ${Object.keys(PROVIDERS).join(', ')}.`);
  const sections: string[] = [];
  if (kind !== 'text') sections.push(await imageSection(ctx, search));
  if (kind !== 'image') sections.push(await textSection(ctx, search, provider as ProviderId | undefined));
  return ok(sections.join('\n\n'));
}

export async function setModelTool(ctx: ToolContext, args: Record<string, unknown>): Promise<ToolResult> {
  const env = envOf(ctx);

  if (args.kind === 'image') {
    if (args.auto !== undefined) {
      if (!AUTO_MODES.includes(args.auto as AutoMode)) return problem(`auto is one of ${AUTO_MODES.join(', ')}.`);
      writeSettings(ctx.lib, { imagine: { auto: args.auto } });
      return ok(`Image model: AutoPick "${String(args.auto)}". It picks the model at the time of each image.`);
    }
    const model = str(args.model);
    if (!model) return problem('Name the image model (see list_models), or pass auto: strongest, balanced or cheapest.');
    if (args.backend !== undefined && !isBackendId(args.backend)) return problem(`Unknown backend "${String(args.backend)}". Backends: ${BACKEND_IDS.join(', ')}.`);
    if (removedImageModels(ctx.lib).has(model)) return problem(REMOVED_MESSAGE);
    const found = await findImageModel(ctx, model, args.backend as BackendId | undefined);
    if (!found) return problem(`No backend lists an image model "${model}". list_models kind "image" shows the ones available.`);
    writeSettings(ctx.lib, { imagine: { backend: found.backend, model } });
    return ok(`Image model set to ${model} (${BACKEND_LABELS[found.backend]}). generate_image uses it unless a call names another.`);
  }

  if (args.kind === 'text') {
    const provider = str(args.provider);
    if (!provider || !isProviderId(provider)) return problem(`Name the provider: ${Object.keys(PROVIDERS).join(', ')}.`);
    if (!hasKeys(provider, env)) return problem(`Add ${PROVIDERS[provider].keyEnv.join(' and ')} to .env and restart the server; ${PROVIDERS[provider].label} has no key.`);
    const settings = readSettings(ctx.lib);
    const saved = settings.models[provider] ?? {};
    const vision = str(args.vision) ?? saved.vision;
    const text = str(args.text) ?? saved.text;
    const use = args.use !== false;
    writeSettings(ctx.lib, {
      models: { ...settings.models, [provider]: { ...(vision ? { vision } : {}), ...(text ? { text } : {}) } },
      ...(use ? { order: [provider, ...settings.order.filter((p) => p !== provider)] } : {}),
    });
    const next = readSettings(ctx.lib);
    return ok(
      `${PROVIDERS[provider].label}: vision ${next.models[provider]?.vision || PROVIDERS[provider].vision.id || 'not chosen'}, text ${next.models[provider]?.text || PROVIDERS[provider].text.id || 'not chosen'}.${use ? ' It is the provider in use now.' : ''} Model ids are not checked here; list_models kind "text" shows the ones the provider offers.`,
    );
  }

  return problem('kind is "image" (makes pictures) or "text" (reads images and writes prompts).');
}
