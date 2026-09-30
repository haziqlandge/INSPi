import type { Metadata } from 'next';
import { CollectionsView } from '@/components/collections/collections-view';

export const metadata: Metadata = { title: 'Collections' };

export default function CollectionsPage() {
  return <CollectionsView />;
}
