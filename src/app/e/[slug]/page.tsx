import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { EntryView } from '@/components/entry/entry-view';
import { ensureWorker } from '@/lib/jobs/worker';
import { library } from '@/lib/store';

// Entries change as they are analysed and edited; always read the current state.
export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const entry = library().getEntry(slug);
  return { title: entry && entry.versions.length ? entry.name : 'Entry' };
}

/** One template for every entry: images on the left, details and the prompt on the right. */
export default async function EntryPage({ params }: Props) {
  const { slug } = await params;
  ensureWorker();
  const entry = library().getEntry(slug);
  if (!entry) notFound();
  return <EntryView key={entry.id} initial={entry} />;
}
