import type { EntryDetail, RunChoice, Steer } from '@/lib/types';
import { announceChange, api } from './api';

/** Mutations shared by cards and the entry page. Each tells open lists to refresh. */

export async function setFavorite(id: string, favorite: boolean): Promise<EntryDetail> {
  const entry = await api<EntryDetail>(`/api/entries/${id}`, { method: 'PATCH', json: { favorite } });
  announceChange();
  return entry;
}

export async function updateEntry(
  id: string,
  patch: { name?: string; category?: string; tags?: string[]; activeVersionId?: string },
): Promise<EntryDetail> {
  const entry = await api<EntryDetail>(`/api/entries/${id}`, { method: 'PATCH', json: patch });
  announceChange();
  return entry;
}

export async function retryEntry(id: string, steer?: Steer, run?: RunChoice): Promise<EntryDetail> {
  const body = steer || run ? { ...(steer ?? {}), ...(run ? { run } : {}) } : undefined;
  const entry = await api<EntryDetail>(`/api/entries/${id}/retry`, { method: 'POST', ...(body ? { json: body } : {}) });
  announceChange();
  return entry;
}

export async function deleteEntry(id: string): Promise<void> {
  await api(`/api/entries/${id}`, { method: 'DELETE' });
  announceChange();
}

export async function restoreEntry(id: string): Promise<void> {
  await api(`/api/entries/${id}/restore`, { method: 'POST' });
  announceChange();
}
