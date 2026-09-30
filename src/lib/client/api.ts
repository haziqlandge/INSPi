/** Browser-side helper: JSON in, JSON out, and the server's own words when something fails. */
export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, ...rest } = init ?? {};
  let response: Response;
  try {
    response = await fetch(path, {
      ...rest,
      headers: json === undefined ? rest.headers : { 'content-type': 'application/json', ...rest.headers },
      body: json === undefined ? rest.body : JSON.stringify(json),
    });
  } catch {
    throw new Error('The server could not be reached. Check that it is still running.');
  }
  const payload = (await response.json().catch(() => null)) as { error?: string } | null;
  if (!response.ok) throw new Error(payload?.error || `Something went wrong (${response.status}).`);
  return payload as T;
}

/** Tells every open list that the library changed, so it can refetch. */
export const LIBRARY_CHANGED = 'inspi:library-changed';

export function announceChange(): void {
  window.dispatchEvent(new Event(LIBRARY_CHANGED));
}
