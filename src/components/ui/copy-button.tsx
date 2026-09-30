'use client';

import { AnimatePresence, motion } from 'motion/react';
import { useRef, useState, type ReactNode } from 'react';
import { useSpark } from '@/components/feedback/spark';
import { useCopy, useToast } from '@/components/feedback/toast';
import { CheckIcon, CopyIcon } from './icons';

interface Props {
  /** The text to copy, or a way to get it. Null means there is nothing to copy yet. */
  text: string | (() => string | null | Promise<string | null>);
  label: string;
  /** Called on hover or focus, to fetch text ahead of the click. */
  warm?: () => void;
  variant?: 'icon' | 'primary' | 'plain';
  children?: ReactNode;
  className?: string;
  disabled?: boolean;
}

const CONFIRM_MS = 1400;

/** Copies, swaps its icon for a tick, throws a spark, and raises the "Copied to clipboard" notice. */
export function CopyButton({ text, label, warm, variant = 'icon', children, className = '', disabled }: Props) {
  const copy = useCopy();
  const toast = useToast();
  const spark = useSpark();
  const [done, setDone] = useState(false);
  const button = useRef<HTMLButtonElement>(null);

  async function onClick() {
    try {
      const value = typeof text === 'function' ? await text() : text;
      if (!value) {
        toast.show('There is no prompt to copy yet.', { tone: 'error' });
        return;
      }
      if (!(await copy(value))) return;
      const rect = button.current?.getBoundingClientRect();
      if (rect) spark(rect.left + rect.width / 2, rect.top + rect.height / 2);
      setDone(true);
      window.setTimeout(() => setDone(false), CONFIRM_MS);
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'The prompt could not be loaded.', { tone: 'error' });
    }
  }

  const base = variant === 'icon' ? 'icon-btn' : variant === 'primary' ? 'btn btn-primary' : 'btn';

  return (
    <button
      ref={button}
      type="button"
      className={`${base} ${className}`}
      onClick={onClick}
      onPointerEnter={warm}
      onFocus={warm}
      disabled={disabled}
      aria-label={variant === 'icon' ? label : undefined}
      title={variant === 'icon' ? label : undefined}
    >
      <span className="relative grid h-[18px] w-[18px] place-items-center">
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={done ? 'done' : 'copy'}
            initial={{ scale: 0.4, opacity: 0, rotate: -30 }}
            animate={{ scale: 1, opacity: 1, rotate: 0 }}
            exit={{ scale: 0.4, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 600, damping: 26 }}
            className="absolute inset-0 grid place-items-center"
          >
            {done ? <CheckIcon size={17} /> : <CopyIcon size={17} />}
          </motion.span>
        </AnimatePresence>
      </span>
      {children}
    </button>
  );
}
