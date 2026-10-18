'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { placePopover, type Placement } from './place-popover';
import { Portal } from './portal';

const FOCUSABLE = 'button:not([disabled]), select:not([disabled]), input:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])';

/**
 * A small panel anchored to a button, drawn at the end of <body> above dialogs. It stays on screen
 * (place-popover.ts), scrolls inside when tall, keeps Tab inside, and Escape or a press outside
 * closes it and hands the focus back to the button. Escape is caught first, so a dialog under it
 * stays open.
 */
export function Popover({
  open,
  anchor,
  onClose,
  label,
  width = 360,
  children,
}: {
  open: boolean;
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  label: string;
  width?: number;
  children: ReactNode;
}) {
  const panel = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);

  useLayoutEffect(() => {
    if (!open) {
      setPlace(null);
      return;
    }
    const measure = () => {
      const a = anchor.current?.getBoundingClientRect();
      const content = panel.current?.firstElementChild as HTMLElement | null;
      if (!a || !content) return;
      setPlace(placePopover(a, { width, height: content.scrollHeight + 2 }, { width: window.innerWidth, height: window.innerHeight }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    const content = panel.current?.firstElementChild;
    if (content) observer.observe(content);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [open, width, anchor]);

  useEffect(() => {
    if (!open) return;
    const button = anchor.current;
    const first = panel.current?.querySelector<HTMLElement>(FOCUSABLE);
    first?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        onClose();
        return;
      }
      if (event.key !== 'Tab' || !panel.current) return;
      const items = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)];
      if (!items.length) return;
      const [head, tail] = [items[0], items[items.length - 1]];
      if (event.shiftKey && document.activeElement === head) {
        event.preventDefault();
        tail.focus();
      } else if (!event.shiftKey && document.activeElement === tail) {
        event.preventDefault();
        head.focus();
      }
    };
    const onPress = (event: PointerEvent) => {
      const target = event.target as Node;
      if (panel.current?.contains(target) || button?.contains(target)) return;
      onClose();
    };
    window.addEventListener('keydown', onKey, true);
    document.addEventListener('pointerdown', onPress, true);
    return () => {
      window.removeEventListener('keydown', onKey, true);
      document.removeEventListener('pointerdown', onPress, true);
      button?.focus();
    };
  }, [open, anchor, onClose]);

  return (
    <Portal>
      <AnimatePresence>
        {open && (
          <motion.div
            ref={panel}
            data-popover
            role="dialog"
            aria-label={label}
            className="fixed z-[80] overflow-y-auto rounded-2xl border border-line bg-surface shadow-lift"
            style={place ? { top: place.top, left: place.left, width: place.width, maxHeight: place.maxHeight } : { top: -9999, left: -9999, width }}
            initial={{ opacity: 0, y: place?.side === 'above' ? 6 : -6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: place?.side === 'above' ? 6 : -6 }}
            transition={{ duration: 0.16, ease: [0.2, 0.7, 0.1, 1] }}
          >
            <div className="p-4">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  );
}
