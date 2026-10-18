import type { ProviderId, chatJson } from '../ai/client';
import type { ModelListing } from '../ai/status';
import type { BackendId, ImageModel, ImagineRequest } from '../imagine/types';
import type { Library } from '../store/library';

/** What the tools need from the process they run in. */
export interface ToolContext {
  lib: Library;
  mediaRoot: string;
  /** Where the app runs, for links back to entry pages. */
  baseUrl: string;
  /** Replaceable pieces; tests pass fakes, the server leaves it out. */
  deps?: ToolDeps;
}

export interface ToolDeps {
  /** Environment holding the API keys; process.env when missing. */
  env?: Record<string, string | undefined>;
  imageModels?: (backend: BackendId) => Promise<ImageModel[]>;
  textModels?: (provider: ProviderId) => Promise<ModelListing>;
  generate?: (backend: BackendId, req: ImagineRequest) => Promise<{ bytes: Buffer; contentType: string }>;
  chat?: typeof chatJson;
  /** Runs the analysis queued for an entry and leaves its result in the library. */
  analyze?: (lib: Library, entryId: string) => Promise<void>;
}

export type Content = { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string };

export interface ToolResult {
  content: Content[];
  isError?: boolean;
}

export const ok = (text: string): ToolResult => ({ content: [{ type: 'text', text }] });
export const problem = (text: string): ToolResult => ({ content: [{ type: 'text', text }], isError: true });

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export const envOf = (ctx: ToolContext): NodeJS.ProcessEnv => (ctx.deps?.env ?? process.env) as NodeJS.ProcessEnv;
