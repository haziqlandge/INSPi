import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { composePrompt, specJson } from '../copy/compose';
import type { Mode } from '../types';
import { ok, problem, str, type ToolContext, type ToolResult } from './context';
import { analyzeImageTool, generateImageTool, writePromptTool } from './create';
import { listModelsTool, setModelTool } from './models';
import { resolveReference } from './reference';

export type { ToolContext, ToolResult } from './context';

/**
 * What coding agents (Claude Code, Cursor…) can ask INSPi over MCP. Looking things up is read-only;
 * the tools that make something (an image, a prompt, an entry) or switch a model say so in their
 * annotations and only ever add to the library or change a setting.
 */

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; destructiveHint?: false; openWorldHint: boolean };
}

const REFERENCE = {
  type: 'string',
  description: 'The entry’s name (as shown in INSPi, any case), its URL slug, or its id.',
};

const PROVIDER_ENUM = ['groq', 'gemini', 'openrouter', 'cloudflare', 'pollinations'];
const BACKEND_ENUM = ['pollinations', 'pollinations-community', 'keyless-url'];

/** `writes`: the tool makes or changes something; `network`: it talks to a service outside the library. */
const tool = (
  name: string,
  title: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[] = [],
  { writes = false, network = false } = {},
): Tool => ({
  name,
  title,
  description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: writes ? { readOnlyHint: false, destructiveHint: false, openWorldHint: network } : { readOnlyHint: true, openWorldHint: network },
});

export const TOOLS: Tool[] = [
  tool(
    'search_references',
    'Search the INSPi library',
    'Finds saved visual references in the INSPi library by words (matched against names, categories, tags and notes), a tag, a category or a mode. Returns each match’s name, slug, category, mode and tags. Use it to find the name to pass to get_prompt.',
    {
      query: { type: 'string', description: 'Words to look for.' },
      tag: { type: 'string', description: 'Only entries with this exact tag.' },
      category: { type: 'string', description: 'Only entries in this category, for example "Landing Page".' },
      mode: { type: 'string', enum: ['web', 'image'], description: '"web" for website references, "image" for image-style references.' },
      favorites: { type: 'boolean', description: 'Only favourites.' },
      limit: { type: 'number', description: 'At most this many results (default 20, max 50).' },
    },
  ),
  tool(
    'get_prompt',
    'Get a reference’s prompt',
    'Returns the copy-ready prompt INSPi made for a reference: an instruction followed by the design-system JSON (format "full"), or the JSON alone (format "json"). Web references describe a page to rebuild as HTML; image references describe a visual style for an image generator. Uses the version the entry currently copies unless a version number is given.',
    {
      reference: REFERENCE,
      format: { type: 'string', enum: ['full', 'json'], description: '"full" (default): instruction and JSON. "json": the JSON only.' },
      version: { type: 'number', description: 'A specific version number (1, 2…) instead of the active one.' },
    },
    ['reference'],
  ),
  tool(
    'get_reference',
    'Describe a reference',
    'Describes one saved reference: name, category, mode, tags, collections, the short visual note, its versions and how each was made, the number of images, and a link to its page in INSPi.',
    { reference: REFERENCE },
    ['reference'],
  ),
  tool(
    'get_reference_image',
    'Get a reference’s image',
    'Returns one of the reference’s original images, so you can look at it alongside its prompt. Images are numbered from 1; "thumb" is a 720px preview, "full" is up to 2000px.',
    {
      reference: REFERENCE,
      index: { type: 'number', description: 'Which image, from 1 (default 1).' },
      size: { type: 'string', enum: ['full', 'thumb'], description: 'Default "full".' },
    },
    ['reference'],
  ),
  tool(
    'library_overview',
    'Overview of the INSPi library',
    'Lists the categories in use with their counts, the most used tags, and the collections, to help decide what to search for.',
    {},
  ),
  tool(
    'list_models',
    'List image and text models',
    'Lists the models INSPi can use in two separate sections, so you never search for them: IMAGE MODELS (make pictures; Pollinations official and community, with health and whether they take a reference image) and TEXT MODELS (read images and write prompts; per provider that has a key, with vision or text-only marked). The current choices are marked. kind shows one section; search filters by name.',
    {
      kind: { type: 'string', enum: ['all', 'image', 'text'], description: '"image" for picture makers, "text" for models that read images and write text, "all" (default) for both sections.' },
      search: { type: 'string', description: 'Only models whose id contains this.' },
      provider: { type: 'string', enum: PROVIDER_ENUM, description: 'Only this provider’s text models.' },
    },
    [],
    { network: true },
  ),
  tool(
    'set_model',
    'Switch the image or text model',
    'Changes which model INSPi uses, in the app and in these tools. kind "image": pass model (an id from list_models; its backend is found for you) or auto (strongest, balanced or cheapest, chosen at each image). kind "text": pass provider with vision (reads images, for analyze_image) and/or text (writes prompts); that provider becomes the one in use unless use is false.',
    {
      kind: { type: 'string', enum: ['image', 'text'], description: '"image" for picture makers, "text" for the models that read images and write prompts.' },
      model: { type: 'string', description: 'Image model id, for kind "image".' },
      backend: { type: 'string', enum: BACKEND_ENUM, description: 'Only look for the image model on this backend.' },
      auto: { type: 'string', enum: ['strongest', 'balanced', 'cheapest'], description: 'For kind "image": let AutoPick choose the model at each image.' },
      provider: { type: 'string', enum: PROVIDER_ENUM, description: 'Text provider, for kind "text".' },
      vision: { type: 'string', description: 'Model that reads images, for kind "text".' },
      text: { type: 'string', description: 'Model that writes prompts, for kind "text".' },
      use: { type: 'boolean', description: 'Make this provider the one in use (default true).' },
    },
    ['kind'],
    { writes: true },
  ),
  tool(
    'generate_image',
    'Generate an image',
    'Makes an image from a prompt with the chosen image model (or the one named), keeps it on INSPi’s Visualize wall and returns it. Pass save_to (an absolute path) to also write the model’s original file, for example a PNG for a game. aspect sets the shape ("1:1", "2:1", "16:9"…). reference shows a library entry’s picture to a model that takes one. Spends Pollinations Pollen.',
    {
      prompt: { type: 'string', description: 'What to draw. write_prompt can draft one from an idea.' },
      model: { type: 'string', description: 'Image model id from list_models; the saved choice or AutoPick when missing.' },
      backend: { type: 'string', enum: BACKEND_ENUM, description: 'Only needed to force a backend.' },
      aspect: { type: 'string', description: 'Aspect ratio such as "2:1"; a square when missing.' },
      negative: { type: 'string', description: 'What to keep out.' },
      seed: { type: 'number', description: 'Repeatable result where the model supports it.' },
      reference: { type: 'string', description: 'A library entry (name, slug or id) whose picture the model is shown, for models that take one.' },
      save_to: { type: 'string', description: 'Absolute path to write the original image to, e.g. C:/game/sprites/attack.png.' },
    },
    ['prompt'],
    { writes: true, network: true },
  ),
  tool(
    'write_prompt',
    'Write an image prompt',
    'Turns an idea into a ready prompt for generate_image with a text model, plus a short negative. kind "spritesheet" adds what a game sheet needs (grid, equal cells, flat background, animation principles such as smear frames); "ui" is for interface mock-ups. reference lends the style of a library entry. Uses the provider in use, or the provider and model you name.',
    {
      idea: { type: 'string', description: 'What the image should show.' },
      kind: { type: 'string', enum: ['image', 'spritesheet', 'ui'], description: 'Default "image".' },
      reference: { type: 'string', description: 'A library entry (name, slug or id) whose style to match.' },
      provider: { type: 'string', enum: PROVIDER_ENUM, description: 'Use this provider instead of the one in use.' },
      model: { type: 'string', description: 'Text model for that provider.' },
    },
    ['idea'],
    { writes: true, network: true },
  ),
  tool(
    'analyze_image',
    'Turn an image into a prompt',
    'Reverse-engineers a picture into a copy-ready prompt: reads it with a vision model, saves it in the INSPi library as a new entry and returns the prompt. source is an absolute file path, an http(s) address or a data URI. mode "image" (default) writes a style prompt for image generators, "web" a build spec for a website. Takes a minute or more; uses the provider in use unless provider is named.',
    {
      source: { type: 'string', description: 'Absolute file path, http(s) address or data URI of the image.' },
      mode: { type: 'string', enum: ['image', 'web'], description: '"image" (default) or "web".' },
      subject: { type: 'string', enum: ['recreate', 'mine', 'model'], description: 'Image mode: recreate the picture, use subject_text, or leave the subject to the model.' },
      subject_text: { type: 'string', description: 'The subject to draw when subject is "mine".' },
      changes: { type: 'string', description: 'Changes from the reference the prompt must apply.' },
      provider: { type: 'string', enum: PROVIDER_ENUM, description: 'Use this provider instead of the one in use.' },
      vision_model: { type: 'string', description: 'Model that reads the image, for that provider.' },
      text_model: { type: 'string', description: 'Model that writes the prompt, for that provider.' },
    },
    ['source'],
    { writes: true, network: true },
  ),
];

function listLine(entry: { name: string; slug: string; category: string; mode: Mode; tags: string[]; status: string }): string {
  const state = entry.status === 'ready' ? '' : ` [${entry.status}]`;
  return `- ${entry.name} (slug: ${entry.slug}) — ${entry.category}, ${entry.mode === 'web' ? 'website' : 'image style'}${entry.tags.length ? `; tags: ${entry.tags.join(', ')}` : ''}${state}`;
}

export async function callTool(ctx: ToolContext, name: string, args: Record<string, unknown> = {}): Promise<ToolResult> {
  const { lib } = ctx;
  switch (name) {
    case 'search_references': {
      const limit = Math.min(50, Math.max(1, Number(args.limit) || 20));
      const mode = args.mode === 'web' || args.mode === 'image' ? args.mode : undefined;
      const { items, total } = lib.listEntries({ q: str(args.query), tag: str(args.tag)?.toLowerCase(), category: str(args.category), mode, favorite: args.favorites === true || undefined, limit });
      if (!items.length) return ok('No references match. library_overview lists the categories and tags in use.');
      return ok(`${total} ${total === 1 ? 'reference' : 'references'}${total > items.length ? `, first ${items.length}` : ''}:\n${items.map(listLine).join('\n')}`);
    }

    case 'get_prompt': {
      const found = resolveReference(lib, args.reference);
      if ('error' in found) return problem(found.error);
      const { entry } = found;
      const version =
        args.version !== undefined ? entry.versions.find((v) => v.n === Number(args.version)) : entry.versions.find((v) => v.id === entry.activeVersionId);
      if (!version) {
        return problem(
          entry.versions.length
            ? `${entry.name} has versions ${entry.versions.map((v) => v.n).join(', ')}; there is no version ${String(args.version)}.`
            : `${entry.name} has no prompt yet (${entry.status}).`,
        );
      }
      return ok(args.format === 'json' ? specJson(version.spec) : composePrompt(version.spec));
    }

    case 'get_reference': {
      const found = resolveReference(lib, args.reference);
      if ('error' in found) return problem(found.error);
      const { entry } = found;
      const active = entry.versions.find((v) => v.id === entry.activeVersionId);
      const lines = [
        `${entry.name}`,
        `Category: ${entry.category}. Mode: ${entry.mode === 'web' ? 'website' : 'image style'}. Status: ${entry.status}.`,
        entry.tags.length ? `Tags: ${entry.tags.join(', ')}` : 'No tags.',
        entry.collections.length ? `Collections: ${entry.collections.map((c) => c.name).join(', ')}` : '',
        active ? `Note: ${active.note}` : '',
        `Images: ${entry.images.length}.`,
        entry.versions.length
          ? `Versions: ${entry.versions.map((v) => `${v.n}${v.id === entry.activeVersionId ? ' (active)' : ''}: ${v.lens}${v.steer?.note ? `, guided by "${v.steer.note}"` : ''}, ${v.provider} ${v.model}, ${v.createdAt.slice(0, 10)}`).join('; ')}`
          : 'No versions yet.',
        `Page: ${ctx.baseUrl}/e/${entry.slug}`,
      ];
      return ok(lines.filter(Boolean).join('\n'));
    }

    case 'get_reference_image': {
      const found = resolveReference(lib, args.reference);
      if ('error' in found) return problem(found.error);
      const { entry } = found;
      const index = Math.max(1, Math.floor(Number(args.index) || 1));
      const image = entry.images[index - 1];
      if (!image) return problem(`${entry.name} has ${entry.images.length} ${entry.images.length === 1 ? 'image' : 'images'}.`);
      const file = join(ctx.mediaRoot, entry.id, `${image.id}${args.size === 'thumb' ? '.thumb' : ''}.webp`);
      try {
        const data = await readFile(file);
        return { content: [{ type: 'image', data: data.toString('base64'), mimeType: 'image/webp' }] };
      } catch {
        return problem(`The image file for ${entry.name} is missing.`);
      }
    }

    case 'library_overview': {
      const categories = lib.categoryCounts();
      const tags = lib.topTags(40);
      const collections = lib.listCollections();
      return ok(
        [
          categories.length ? `Categories: ${categories.map((c) => `${c.name} (${c.count})`).join(', ')}` : 'The library is empty.',
          tags.length ? `Most used tags: ${tags.map((t) => `${t.name} (${t.count})`).join(', ')}` : '',
          collections.length ? `Collections: ${collections.map((c) => `${c.name} (${c.count})`).join(', ')}` : '',
        ]
          .filter(Boolean)
          .join('\n'),
      );
    }

    case 'list_models':
      return listModelsTool(ctx, args);
    case 'set_model':
      return setModelTool(ctx, args);
    case 'generate_image':
      return generateImageTool(ctx, args);
    case 'write_prompt':
      return writePromptTool(ctx, args);
    case 'analyze_image':
      return analyzeImageTool(ctx, args);

    default:
      return problem(`Unknown tool "${name}".`);
  }
}
