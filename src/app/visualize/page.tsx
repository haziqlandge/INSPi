import type { Metadata } from 'next';
import { VisualizeView } from '@/components/visualize/visualize-view';

export const metadata: Metadata = { title: 'Visualize' };

export default function VisualizePage() {
  return <VisualizeView />;
}
