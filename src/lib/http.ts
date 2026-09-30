/** Small helpers shared by the route handlers. */

export function ok<T>(data: T, init?: ResponseInit): Response {
  return Response.json(data, init);
}

export function fail(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/**
 * The app has no login while it runs locally, so a page on another site must not be able to
 * change the library by posting to localhost. Browsers send Origin on those requests.
 */
export function crossOrigin(request: Request): Response | null {
  const origin = request.headers.get('origin');
  if (!origin) return null;
  try {
    if (new URL(origin).host === new URL(request.url).host) return null;
    const host = request.headers.get('host');
    if (host && new URL(origin).host === host) return null;
  } catch {
    // fall through
  }
  return fail(403, 'Cross-site requests are not allowed.');
}

export async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = await request.json();
    return body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
