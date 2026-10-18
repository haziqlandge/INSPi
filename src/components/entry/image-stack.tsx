'use client';

import { MotionConfig, motion } from 'motion/react';
import { ViewTransition, useCallback, useState, type ReactNode } from 'react';
import { PrintLightbox, type StripItem } from '@/components/fx/library';
import { Skeleton } from '@/components/ui/skeleton';
import type { EntryImage } from '@/lib/types';

interface Props {
  entryId: string;
  images: EntryImage[];
  name: string;
  /** Still being analysed: the image gives way to a shimmering placeholder of the same shape. */
  developing: boolean;
  /** The analysis failed: the images are greyed out. */
  failed?: boolean;
  /** Shown under the image, inside the sticky column (the palette). */
  footer?: ReactNode;
}

/**
 * The enlarge-in-place behaviour follows UI Layouts' media-modal: the image in the print and the
 * image in the lightbox share a layout id, so one grows out of the other instead of cutting.
 */
const ZOOM_SPRING = { type: 'spring', stiffness: 300, damping: 30, mass: 0.5 } as const;

export function ImageStack({ entryId, images, name, developing, failed, footer }: Props) {
  const [selected, setSelected] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const current = images[Math.min(selected, images.length - 1)];
  const close = useCallback(() => setZoomed(false), []);
  // The shared zoom view; its arrows move the print on the page too.
  const prints: StripItem[] = images.map((image, i) => ({
    id: image.id,
    src: image.full,
    width: image.width,
    height: image.height,
    alt: `${name}, image ${i + 1}`,
    caption: null,
  }));

  if (!current) return null;
  // Tall images are capped so the print stays on screen beside the details.
  const ratio = current.width / current.height;
  const maxHeight = current.height / current.width > 1.35 ? 78 : 72;
  // The print's size comes from the image's known proportions, never from the file having loaded,
  // so switching images changes the page height once and cleanly instead of collapsing in between.
  const figureWidth = `min(100%, calc(${maxHeight}dvh * ${ratio} + 1.25rem))`;
  // Everything below the print stays put while switching: the space is always that of the tallest image.
  const tallest = `max(${images
    .map((image) => `min(${image.height / image.width > 1.35 ? 78 : 72}dvh, (100cqw - 1.25rem) * ${image.height / image.width})`)
    .join(', ')})`;

  return (
    <MotionConfig transition={ZOOM_SPRING}>
    <div className="[container-type:inline-size] lg:sticky lg:top-6">
      <div className="flex items-center justify-center" style={{ minHeight: images.length > 1 ? `calc(${tallest} + 1.25rem)` : undefined }}>
      <figure className="print mx-auto p-2.5" style={{ width: figureWidth }}>
        {developing ? (
          <Skeleton className="rounded-[2px]" style={{ aspectRatio: `${current.width} / ${current.height}` }} label="Reading the image" />
        ) : (
          <div className="relative overflow-hidden rounded-[2px]" style={{ backgroundColor: current.placeholder, aspectRatio: `${current.width} / ${current.height}` }}>
            <button
              type="button"
              className="block h-full w-full cursor-zoom-in"
              onClick={() => setZoomed(true)}
              aria-label={`Enlarge image ${selected + 1} of ${images.length}`}
            >
              <motion.div layoutId={`zoom-${current.id}`} className="h-full w-full">
                <ViewTransition name={selected === 0 ? `cover-${entryId}` : undefined} share="morph" default="none">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    key={current.id}
                    src={current.full}
                    alt={`${name}, image ${selected + 1}`}
                    width={current.width}
                    height={current.height}
                    className={`block h-full w-full ${failed ? 'opacity-60 grayscale' : ''}`}
                  />
                </ViewTransition>
              </motion.div>
            </button>
          </div>
        )}
      </figure>
      </div>

      {images.length > 1 && (
        <ul className="no-scrollbar mt-4 flex justify-center gap-2.5 overflow-x-auto px-1 pb-2">
          {images.map((image, index) => (
            <li key={image.id} className="flex-none">
              <button
                type="button"
                onClick={() => setSelected(index)}
                aria-label={`Show image ${index + 1}`}
                aria-current={index === selected}
                className={`print block p-1 transition-transform duration-200 ${
                  index === selected ? '-translate-y-1 border-head' : 'opacity-75 hover:opacity-100'
                }`}
              >
                {developing ? (
                  <Skeleton className="h-14 w-14 rounded-[2px] sm:h-16 sm:w-16" />
                ) : (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={image.thumb}
                    alt=""
                    width={image.width}
                    height={image.height}
                    loading="lazy"
                    className={`h-14 w-14 rounded-[2px] object-cover sm:h-16 sm:w-16 ${failed ? 'opacity-60 grayscale' : ''}`}
                  />
                )}
              </button>
            </li>
          ))}
        </ul>
      )}

      {footer}

      <PrintLightbox items={prints} index={zoomed ? selected : null} onIndex={setSelected} layoutPrefix="zoom" onClose={close} />
    </div>
    </MotionConfig>
  );
}
