'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Keeps the dialog open while something is being saved. */
  locked?: boolean;
  /** A wider panel for browsing lists. */
  wide?: boolean;
}

/** A centred dialog on desktop, a bottom sheet on phones. Escape or a click outside closes it. */
export function Modal({ open, onClose, title, children, locked, wide }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  // Read through refs so a parent re-render (a poll, a ticking countdown) does not re-run the
  // effect below and yank focus back to the first field while someone is typing.
  const close = useRef(onClose);
  const isLocked = useRef(locked);
  close.current = onClose;
  isLocked.current = locked;

  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isLocked.current) close.current();
    };
    window.addEventListener('keydown', onKey);
    // Move focus into the dialog, and give it back when the dialog goes away.
    panel.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[65] flex items-end justify-center bg-head/30 p-3 backdrop-blur-[2px] sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !locked) onClose();
          }}
        >
          <motion.div
            ref={panel}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className={`max-h-[90dvh] w-full overflow-y-auto ${wide ? 'max-w-2xl' : 'max-w-lg'} rounded-[1.25rem] border border-line bg-surface p-5 shadow-lift sm:p-6`}
            initial={{ y: 36, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <h2 className="display text-[1.625rem] leading-tight">{title}</h2>
              <button type="button" className="icon-btn -mr-2 -mt-1" onClick={onClose} disabled={locked} aria-label="Close">
                <CloseIcon />
              </button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
