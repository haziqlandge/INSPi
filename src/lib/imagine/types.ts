/** Where an image is generated. Only the one picked is tried; a failure is reported, never re-routed. */
export type BackendId = 'pollinations' | 'pollinations-community' | 'keyless-url';

export const BACKEND_IDS: BackendId[] = ['pollinations', 'pollinations-community', 'keyless-url'];

export type ModelHealth = 'healthy' | 'degraded' | 'unknown';

/**
 * Pollinations' health label, corrected by its own numbers: a model that worked for 80% or less of
 * recent requests (Pollinations' reliability cut-off) is degraded whatever its label says.
 */
export function healthFrom(status: string | undefined, successRate: number | null | undefined): ModelHealth {
  if (typeof successRate === 'number' && successRate <= 80) return 'degraded';
  return status === 'healthy' || status === 'degraded' ? status : 'unknown';
}

export interface ImageModel {
  /** The id sent as `model`. */
  id: string;
  label: string;
  /** Takes a reference image (style transfer, edits). */
  acceptsImage: boolean;
  health: ModelHealth;
  /** Share of recent requests that worked, 0–100, when Pollinations has measured it. */
  successRate: number | null;
}

export interface ImagineRequest {
  prompt: string;
  negative?: string;
  width: number;
  height: number;
  seed?: number;
  model: string;
  /** A reference picture as a data URI, for models that take one; sent to the edits endpoint. */
  image?: string;
}

export type ImagineErrorKind = 'auth' | 'no_pollen' | 'rate_limit' | 'not_image' | 'network' | 'server';

export class ImagineError extends Error {
  constructor(
    public kind: ImagineErrorKind,
    message: string,
    public status: number | null = null,
  ) {
    super(message);
    this.name = 'ImagineError';
  }
}

export function isBackendId(value: unknown): value is BackendId {
  return typeof value === 'string' && (BACKEND_IDS as string[]).includes(value);
}
