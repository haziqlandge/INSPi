'use client';

import { AnimatePresence, motion } from 'motion/react';
import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface ToastAction {
  label: string;
  run: () => void;
}

interface Toast {
  id: number;
  message: string;
  tone: 'plain' | 'error';
  action?: ToastAction;
}

interface ToastApi {
  show: (message: string, options?: { tone?: Toast['tone']; action?: ToastAction; duration?: number }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const PLAIN_MS = 2200;
const ACTION_MS = 7000;
const MAX_VISIBLE = 3;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((t) => t.id !== id)), []);

  const show = useCallback<ToastApi['show']>(
    (message, options = {}) => {
      const id = nextId.current++;
      const toast: Toast = { id, message, tone: options.tone ?? 'plain', action: options.action };
      setToasts((list) => [...list.slice(-(MAX_VISIBLE - 1)), toast]);
      const duration = options.duration ?? (options.action ? ACTION_MS : options.tone === 'error' ? 5000 : PLAIN_MS);
      window.setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--dock-space)-1rem)] z-[70] flex flex-col items-center gap-2 px-4"
        role="status"
        aria-live="polite"
      >
        <AnimatePresence initial={false}>
          {toasts.map((toast) => (
            <motion.div
              key={toast.id}
              layout
              initial={{ opacity: 0, y: 22, scale: 0.94, rotate: -1.5 }}
              animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
              exit={{ opacity: 0, y: 10, scale: 0.96, transition: { duration: 0.16 } }}
              transition={{ type: 'spring', stiffness: 520, damping: 32, mass: 0.7 }}
              drag="x"
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.6}
              onDragEnd={(_, info) => {
                if (Math.abs(info.offset.x) > 80) dismiss(toast.id);
              }}
              className={`pointer-events-auto flex max-w-[min(92vw,30rem)] items-center gap-3 rounded-full py-2.5 pl-4 text-sm font-medium shadow-dock ${
                toast.action ? 'pr-1.5' : 'pr-4'
              } ${toast.tone === 'error' ? 'bg-danger text-paper' : 'bg-head text-paper'}`}
            >
              <span className="min-w-0">{toast.message}</span>
              {toast.action && (
                <button
                  type="button"
                  className="rounded-full bg-paper/15 px-3 py-1.5 text-[0.8125rem] transition-colors hover:bg-paper/25"
                  onClick={() => {
                    toast.action!.run();
                    dismiss(toast.id);
                  }}
                >
                  {toast.action.label}
                </button>
              )}
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (!api) throw new Error('useToast needs a ToastProvider above it.');
  return api;
}

/** The modern clipboard API is blocked on plain-http pages (a phone on the LAN), so fall back. */
function legacyCopy(text: string): boolean {
  const area = document.createElement('textarea');
  area.value = text;
  area.setAttribute('readonly', '');
  area.style.position = 'fixed';
  area.style.opacity = '0';
  document.body.appendChild(area);
  area.select();
  let copied = false;
  try {
    copied = document.execCommand('copy');
  } catch {
    copied = false;
  }
  document.body.removeChild(area);
  return copied;
}

export async function copyText(text: string): Promise<boolean> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return legacyCopy(text);
    }
  }
  return legacyCopy(text);
}

/** Copies and confirms with the floating notice, wherever it is called from. */
export function useCopy(): (text: string) => Promise<boolean> {
  const { show } = useToast();
  return useCallback(
    async (text: string) => {
      const copied = await copyText(text);
      if (copied) show('Copied to clipboard');
      else show('Copying was blocked. Select the text and copy it by hand.', { tone: 'error' });
      return copied;
    },
    [show],
  );
}
