import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { CollectionView } from '@/components/collections/collection-view';
import { library } from '@/lib/store';

export const dynamic = 'force-dynamic';

type Props = { params: Promise<{ slug: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  return { title: library().getCollection(slug)?.name ?? 'Collection' };
}

export default async function CollectionPage({ params }: Props) {
  const { slug } = await params;
  const collection = library().getCollection(slug);
  if (!collection) notFound();
  return <CollectionView key={collection.id} initial={collection} />;
}
