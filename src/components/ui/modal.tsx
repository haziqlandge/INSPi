'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, type ReactNode } from 'react';
import { CloseIcon } from './icons';
import { Portal } from './portal';

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  /** Keeps the dialog open while something is being saved. */
  locked?: boolean;
  /** A wider panel for browsing lists. */
  wide?: boolean;
  /** 'full' fills most of the screen and keeps the title bar in view while the body scrolls. */
  size?: 'default' | 'full';
  /** Extra controls in the title bar, beside the close button. */
  actions?: ReactNode;
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/** A centred dialog on desktop, a bottom sheet on phones. Escape or a click outside closes it. */
export function Modal({ open, onClose, title, children, locked, wide, size = 'default', actions }: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLDivElement>(null);
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
      // Tab stays inside the dialog.
      if (event.key === 'Tab' && panel.current) {
        const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null);
        if (!items.length) return;
        const first = items[0];
        const last = items[items.length - 1];
        const inside = panel.current.contains(document.activeElement);
        if (event.shiftKey && (document.activeElement === first || !inside)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && (document.activeElement === last || !inside)) {
          event.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    // Move focus into the dialog, and give it back when the dialog goes away.
    panel.current?.querySelector<HTMLElement>('[data-autofocus], input, select, textarea, button')?.focus();
    return () => {
      window.removeEventListener('keydown', onKey);
      previous?.focus?.();
    };
  }, [open]);

  const full = size === 'full';

  // Sticky rows inside a full dialog sit right under the title bar: its height is published as
  // --modal-head, so they need no guessed offset.
  useEffect(() => {
    if (!open || !full || !head.current || !panel.current) return;
    const target = panel.current;
    // The observer reports the laid-out size, unaffected by the dialog's entrance scale, and fires
    // once straight away.
    const observer = new ResizeObserver(([entry]) => {
      target.style.setProperty('--modal-head', `${entry.borderBoxSize[0].blockSize}px`);
    });
    observer.observe(head.current);
    return () => observer.disconnect();
  }, [open, full]);

  return (
    <Portal>
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-[65] flex items-end justify-center bg-scrim p-3 backdrop-blur-[2px] sm:items-center sm:p-6"
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
            className={`w-full overflow-y-auto rounded-[1.25rem] border border-line bg-surface shadow-lift ${
              full ? 'h-[94dvh] max-w-[76rem] sm:h-[90dvh]' : `max-h-[90dvh] p-5 sm:p-6 ${wide ? 'max-w-2xl' : 'max-w-lg'}`
            }`}
            initial={{ y: 36, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 20, opacity: 0, scale: 0.98 }}
            transition={{ type: 'spring', stiffness: 380, damping: 32 }}
          >
            <div
              ref={head}
              className={`flex items-start justify-between gap-4 ${
                full ? 'sticky top-0 z-10 border-b border-line bg-surface/95 px-5 pb-4 pt-5 backdrop-blur-sm sm:px-7' : 'mb-5'
              }`}
            >
              <h2 className="display text-[1.625rem] leading-tight">{title}</h2>
              <div className="-mr-2 -mt-1 flex items-center gap-1">
                {actions}
                <button type="button" className="icon-btn" onClick={onClose} disabled={locked} aria-label="Close">
                  <CloseIcon />
                </button>
              </div>
            </div>
            {full ? <div className="px-5 pb-8 pt-5 sm:px-7">{children}</div> : children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    </Portal>
  );
}
