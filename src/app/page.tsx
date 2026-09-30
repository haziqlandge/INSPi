import { Suspense } from 'react';
import { Library } from '@/components/gallery/library';

export default function HomePage() {
  return (
    <div className="px-4 pt-4 sm:px-8 sm:pt-6">
      <Suspense fallback={null}>
        <Library />
      </Suspense>
    </div>
  );
}
