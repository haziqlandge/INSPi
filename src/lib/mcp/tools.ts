import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { composePrompt, specJson } from '../copy/compose';
import { slugify } from '../library/slug';
import type { Library } from '../store/library';
import type { EntryDetail, Mode } from '../types';

/**
 * What coding agents (Claude Code, Cursor…) can ask INSPi over MCP. Everything is read-only:
 * the library is looked at, never changed.
 */

export interface ToolContext {
  lib: Library;
  mediaRoot: string;
  /** Where the app runs, for links back to entry pages. */
  baseUrl: string;
}

type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };
export interface ToolResult {
  content: Content[];
  isError?: boolean;
}

interface Tool {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: true; openWorldHint: false };
}

const REFERENCE = {
  type: 'string',
  description: 'The entry’s name (as shown in INSPi, any case), its URL slug, or its id.',
};

const tool = (name: string, title: string, description: string, properties: Record<string, unknown>, required: string[] = []): Tool => ({
  name,
  title,
  description,
  inputSchema: { type: 'object', properties, required, additionalProperties: false },
  annotations: { readOnlyHint: true, openWorldHint: false },
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
];

const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });
const problem = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

type Found = { entry: EntryDetail } | { error: string };

/** Name, slug or id; failing those, a search that must point at exactly one entry. */
function resolve(lib: Library, raw: unknown): Found {
  const reference = str(raw);
  if (!reference) return { error: 'Say which reference: its name, slug or id.' };
  const direct = lib.getEntry(reference) ?? lib.getEntry(slugify(reference));
  if (direct) return { entry: direct };

  const { items } = lib.listEntries({ q: reference, limit: 10 });
  const exact = items.filter((item) => item.name.toLowerCase() === reference.toLowerCase());
  const candidates = exact.length ? exact : items;
  if (candidates.length === 1) return { entry: lib.getEntry(candidates[0].id)! };
  if (candidates.length === 0) return { error: `No reference matches "${reference}". Try search_references.` };
  return { error: `"${reference}" matches several references: ${candidates.map((c) => `${c.name} (${c.slug})`).join(', ')}. Pass one of their slugs.` };
}

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
      const found = resolve(lib, args.reference);
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
      const found = resolve(lib, args.reference);
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
      const found = resolve(lib, args.reference);
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

    default:
      return problem(`Unknown tool "${name}".`);
  }
}
