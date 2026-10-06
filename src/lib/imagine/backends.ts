import { ImagineError, type BackendId, type ImagineRequest } from './types';

/** Pollinations' POST endpoint takes prompts up to this long: room for a whole INSPi prompt with its JSON. */
export const MAX_PROMPT_CHARS = 32_000;
/** The keyless route carries the prompt in the URL, which must stay under proxies' 8K limits. */
export const MAX_URL_PROMPT_CHARS = 1800;
const GENERATIONS_URL = 'https://gen.pollinations.ai/v1/images/generations';
/** Same body plus `image`: the model is shown the reference picture as well as the prompt. */
const EDITS_URL = 'https://gen.pollinations.ai/v1/images/edits';
// GPT Image 2 took 52 s for one image when tested; long prompts can take longer still.
const TIMEOUT_MS = 180_000;

export const BACKEND_LABELS: Record<BackendId, string> = {
  pollinations: 'Pollinations',
  'pollinations-community': 'Pollinations community',
  'keyless-url': 'Keyless URL',
};

export function backendAvailable(backend: BackendId, env: NodeJS.ProcessEnv = process.env): boolean {
  return backend === 'keyless-url' || Boolean(env.POLLINATIONS_API_KEY?.trim());
}

/** Pollinations has no negative field, so the things to avoid ride at the end of the prompt. */
function fullPrompt(req: ImagineRequest, limit: number): string {
  const negative = req.negative?.trim();
  return (negative ? `${req.prompt.trim()}\n\nAvoid: ${negative}` : req.prompt.trim()).slice(0, limit);
}

/** The keyless route's URL: the prompt travels in the path, so it is cut to what a URL can carry. */
export function imageUrl(req: ImagineRequest): string {
  const params = new URLSearchParams({ width: String(req.width), height: String(req.height), nologo: 'true' });
  if (req.seed !== undefined) params.set('seed', String(req.seed));
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(fullPrompt(req, MAX_URL_PROMPT_CHARS))}?${params}`;
}

/** What the bytes are, from their first few: Pollinations' JSON answer does not say. */
function sniff(bytes: Buffer): string {
  if (bytes[0] === 0x89 && bytes[1] === 0x50) return 'image/png';
  if (bytes[0] === 0xff && bytes[1] === 0xd8) return 'image/jpeg';
  if (bytes.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return 'image/png';
}

async function bodyMessage(response: Response): Promise<string> {
  const text = await response.text().catch(() => '');
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } | string; message?: string };
    const error = parsed.error;
    return (typeof error === 'string' ? error : error?.message) || parsed.message || '';
  } catch {
    return text.slice(0, 200);
  }
}

const FAILURES: Record<number, { kind: ImagineError['kind']; message: string }> = {
  401: { kind: 'auth', message: 'Pollinations rejected the key.' },
  403: { kind: 'auth', message: 'Pollinations refused this key for that model.' },
  402: { kind: 'no_pollen', message: 'Out of Pollen for now.' },
  429: { kind: 'rate_limit', message: 'Too many requests; wait a minute.' },
};

/**
 * Generates one image with the backend and model given. Pollinations' models get the whole prompt
 * by POST; the keyless route only has a URL. One try; failures carry Pollinations' own words.
 */
export async function generateImage(
  backend: BackendId,
  req: ImagineRequest,
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: typeof fetch = fetch,
): Promise<{ bytes: Buffer; contentType: string }> {
  let url: string;
  let init: RequestInit;
  if (backend === 'keyless-url') {
    if (req.image) throw new ImagineError('server', 'The keyless route cannot be shown a reference image.');
    url = imageUrl(req);
    init = { headers: {} };
  } else {
    const key = env.POLLINATIONS_API_KEY?.trim();
    if (!key) throw new ImagineError('auth', 'Add POLLINATIONS_API_KEY to .env and restart the server.');
    url = req.image ? EDITS_URL : GENERATIONS_URL;
    init = {
      method: 'POST',
      headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: req.model,
        prompt: fullPrompt(req, MAX_PROMPT_CHARS),
        size: `${req.width}x${req.height}`,
        response_format: 'b64_json',
        ...(req.seed !== undefined ? { seed: req.seed } : {}),
        ...(req.image ? { image: [{ image_url: req.image }] } : {}),
      }),
    };
  }

  let response: Response;
  try {
    response = await fetchImpl(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) });
  } catch (cause) {
    const timedOut = (cause as Error).name === 'TimeoutError';
    throw new ImagineError('network', timedOut ? 'Pollinations took longer than three minutes.' : 'Pollinations could not be reached.');
  }

  if (!response.ok) {
    const detail = await bodyMessage(response);
    const known = FAILURES[response.status] ?? { kind: 'server' as const, message: `Pollinations answered ${response.status}.` };
    throw new ImagineError(known.kind, detail ? `${known.message} (${detail})` : known.message, response.status);
  }

  const contentType = response.headers.get('content-type')?.split(';')[0].trim() ?? '';
  if (backend !== 'keyless-url' && contentType === 'application/json') {
    const payload = (await response.json().catch(() => null)) as { data?: { b64_json?: string }[] } | null;
    const b64 = payload?.data?.[0]?.b64_json;
    if (!b64) throw new ImagineError('not_image', 'Pollinations did not return an image.', response.status);
    const bytes = Buffer.from(b64, 'base64');
    return { bytes, contentType: sniff(bytes) };
  }
  if (!contentType.startsWith('image/')) {
    throw new ImagineError('not_image', 'Pollinations did not return an image.', response.status);
  }
  return { bytes: Buffer.from(await response.arrayBuffer()), contentType };
}
