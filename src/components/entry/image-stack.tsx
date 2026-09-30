'use client';

import { AnimatePresence, MotionConfig, motion } from 'motion/react';
import { ViewTransition, useEffect, useState } from 'react';
import { CloseIcon } from '@/components/ui/icons';
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
}

/**
 * The enlarge-in-place behaviour follows UI Layouts' media-modal: the image in the print and the
 * image in the lightbox share a layout id, so one grows out of the other instead of cutting.
 */
const ZOOM_SPRING = { type: 'spring', stiffness: 300, damping: 30, mass: 0.5 } as const;

export function ImageStack({ entryId, images, name, developing, failed }: Props) {
  const [selected, setSelected] = useState(0);
  const [zoomed, setZoomed] = useState(false);
  const current = images[Math.min(selected, images.length - 1)];

  useEffect(() => {
    if (!zoomed) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setZoomed(false);
      if (event.key === 'ArrowRight') setSelected((i) => (i + 1) % images.length);
      if (event.key === 'ArrowLeft') setSelected((i) => (i - 1 + images.length) % images.length);
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [zoomed, images.length]);

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

      <AnimatePresence>
        {zoomed && (
          <motion.div
            className="fixed inset-0 z-[85] grid cursor-zoom-out place-items-center bg-[#140d0e]/92 p-4 sm:p-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            onClick={() => setZoomed(false)}
            role="dialog"
            aria-modal="true"
            aria-label={`${name}, enlarged`}
          >
            <motion.div
              layoutId={`zoom-${current.id}`}
              className="overflow-hidden rounded-[3px] shadow-lift"
              style={{
                aspectRatio: `${current.width} / ${current.height}`,
                width: `min(94vw, calc(90dvh * ${current.width / current.height}))`,
              }}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={current.full} alt={`${name}, image ${selected + 1}`} className="h-full w-full object-contain" />
            </motion.div>
            <button
              type="button"
              className="absolute right-4 top-4 grid h-10 w-10 place-items-center rounded-full bg-[#f6d9be]/10 text-[#f6d9be] hover:bg-[#f6d9be]/20"
              onClick={() => setZoomed(false)}
              aria-label="Close"
            >
              <CloseIcon />
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
    </MotionConfig>
  );
}
