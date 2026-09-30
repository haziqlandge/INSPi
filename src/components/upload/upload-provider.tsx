'use client';

import { AnimatePresence, motion } from 'motion/react';
import { usePathname, useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useToast } from '@/components/feedback/toast';
import { CloseIcon, PlusIcon } from '@/components/ui/icons';
import { Segmented, Switch } from '@/components/ui/segmented';
import type { ProviderStatus } from '@/lib/ai/status';
import { announceChange, api } from '@/lib/client/api';
import { MAX_IMAGES_COMPRESSED, MAX_IMAGES_PLAIN, packFrames } from '@/lib/media/pack';
import type { Mode } from '@/lib/types';

interface Picked {
  id: string;
  file: File;
  url: string;
}

interface UploadApi {
  /** Opens the file picker. */
  pick: () => void;
}

const UploadContext = createContext<UploadApi | null>(null);

const ACCEPT = 'image/png,image/jpeg,image/webp,image/gif,image/avif';
const MAX_BYTES = 20 * 1024 * 1024;
const TILTS = [-2.2, 1.6, -1.1, 2.4, -1.8, 1.2, -2.6, 1.9, -1.4];

const isImage = (file: File) => file.type.startsWith('image/');

function describe(count: number, compress: boolean, provider: ProviderStatus | null): { text: string; blocked: boolean } {
  if (count === 0) return { text: 'Add an image to begin.', blocked: true };
  if (count > MAX_IMAGES_COMPRESSED) {
    const extra = count - MAX_IMAGES_COMPRESSED;
    return { text: `An entry holds at most ${MAX_IMAGES_COMPRESSED} images. Remove ${extra}.`, blocked: true };
  }
  const frames = packFrames(count, compress).length;
  if (count === 1) return { text: 'One image, one prompt.', blocked: false };
  if (compress) {
    return {
      text: `${count} images on ${frames === 1 ? 'one contact sheet' : `${frames} contact sheets`}, read as one style.`,
      blocked: false,
    };
  }
  // A small per-minute allowance means each image waits about a minute for the one before it.
  const slow = provider && provider.tokensPerMinute < 20_000;
  return {
    text: slow
      ? `${count} images read one at a time, then merged. On ${provider.label} that takes about ${count} minutes; Compress is quicker.`
      : `${count} images read together as one style.`,
    blocked: false,
  };
}

export function UploadProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<Picked[]>([]);
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<Mode>('web');
  const [compress, setCompress] = useState(false);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [provider, setProvider] = useState<ProviderStatus | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const toast = useToast();
  const router = useRouter();
  const pathname = usePathname();

  const add = useCallback(
    (files: File[]) => {
      const images = files.filter(isImage);
      if (images.length === 0) {
        if (files.length) toast.show('Only images can be added.', { tone: 'error' });
        return;
      }
      const tooBig = images.filter((f) => f.size > MAX_BYTES);
      if (tooBig.length) toast.show('Images can be at most 20 MB each.', { tone: 'error' });
      const fresh = images
        .filter((f) => f.size <= MAX_BYTES)
        .map((file) => ({ id: crypto.randomUUID(), file, url: URL.createObjectURL(file) }));
      if (fresh.length === 0) return;
      setPicked((current) => [...current, ...fresh]);
      setOpen(true);
    },
    [toast],
  );

  const close = useCallback(() => {
    setOpen(false);
    setPicked((current) => {
      current.forEach((p) => URL.revokeObjectURL(p.url));
      return [];
    });
    setCompress(false);
  }, []);

  const remove = (id: string) =>
    setPicked((current) => {
      const gone = current.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.url);
      return current.filter((p) => p.id !== id);
    });

  // Paste and drop work anywhere on any page.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = [...(event.clipboardData?.files ?? [])].filter(isImage);
      if (files.length === 0) return;
      event.preventDefault();
      add(files);
    };
    const hasFiles = (event: DragEvent) => [...(event.dataTransfer?.types ?? [])].includes('Files');
    const onEnter = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepth.current++;
      setDragging(true);
    };
    const onLeave = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      dragDepth.current = Math.max(0, dragDepth.current - 1);
      if (dragDepth.current === 0) setDragging(false);
    };
    const onOver = (event: DragEvent) => {
      if (hasFiles(event)) event.preventDefault();
    };
    const onDrop = (event: DragEvent) => {
      if (!hasFiles(event)) return;
      event.preventDefault();
      dragDepth.current = 0;
      setDragging(false);
      add([...(event.dataTransfer?.files ?? [])]);
    };
    window.addEventListener('paste', onPaste);
    window.addEventListener('dragenter', onEnter);
    window.addEventListener('dragleave', onLeave);
    window.addEventListener('dragover', onOver);
    window.addEventListener('drop', onDrop);
    return () => {
      window.removeEventListener('paste', onPaste);
      window.removeEventListener('dragenter', onEnter);
      window.removeEventListener('dragleave', onLeave);
      window.removeEventListener('dragover', onOver);
      window.removeEventListener('drop', onDrop);
    };
  }, [add]);

  // Knowing which provider will run lets the tray say how long a multi-image set takes.
  useEffect(() => {
    if (!open) return;
    api<{ providers: ProviderStatus[]; settings: { compressDefault: boolean } }>('/api/settings')
      .then(({ providers, settings }) => {
        setProvider(providers.find((p) => p.usable) ?? null);
        if (settings.compressDefault) setCompress(true);
      })
      .catch(() => setProvider(null));
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, busy, close]);

  // More than three images only fit as contact sheets.
  const forced = picked.length > MAX_IMAGES_PLAIN;
  const compressed = forced || (compress && picked.length > 1);
  const summary = describe(picked.length, compressed, provider);

  async function submit() {
    if (summary.blocked || busy) return;
    setBusy(true);
    try {
      const form = new FormData();
      picked.forEach((p) => form.append('files', p.file));
      form.append('mode', mode);
      form.append('compress', compressed ? '1' : '0');
      await api('/api/entries', { method: 'POST', body: form });
      close();
      announceChange();
      toast.show('Added. Reading it now.');
      if (pathname !== '/') router.push('/');
    } catch (error) {
      toast.show(error instanceof Error ? error.message : 'The upload failed.', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  const value = useMemo(() => ({ pick: () => input.current?.click() }), []);

  return (
    <UploadContext.Provider value={value}>
      {children}

      <input
        ref={input}
        type="file"
        accept={ACCEPT}
        multiple
        hidden
        onChange={(event) => {
          add([...(event.target.files ?? [])]);
          event.target.value = '';
        }}
      />

      <AnimatePresence>
        {dragging && (
          <motion.div
            key="light-table"
            className="pointer-events-none fixed inset-0 z-[80] grid place-items-center bg-head/35 p-6 backdrop-blur-[3px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            <motion.div
              className="grid h-full max-h-[32rem] w-full max-w-3xl place-items-center rounded-[1.25rem] border-2 border-dashed border-paper/80 bg-surface/90 text-center"
              initial={{ scale: 0.96 }}
              animate={{ scale: 1 }}
              exit={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 420, damping: 30 }}
            >
              <div>
                <p className="display text-[clamp(2rem,6vw,3.5rem)] leading-none">Drop it here</p>
                <p className="mt-3 text-muted">Up to nine images become one entry.</p>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {open && (
          <motion.div
            key="tray"
            className="fixed inset-0 z-[60] flex items-end justify-center bg-head/30 p-3 backdrop-blur-[2px] sm:items-center sm:p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !busy) close();
            }}
          >
            <motion.div
              role="dialog"
              aria-modal="true"
              aria-label="New entry"
              className="max-h-[92dvh] w-full max-w-xl overflow-y-auto rounded-[1.25rem] border border-line bg-surface p-5 shadow-lift sm:p-6"
              initial={{ y: 40, opacity: 0, scale: 0.98 }}
              animate={{ y: 0, opacity: 1, scale: 1 }}
              exit={{ y: 24, opacity: 0, scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 380, damping: 32 }}
            >
              <div className="flex items-start justify-between gap-4">
                <h2 className="display text-[1.75rem] leading-tight">New entry</h2>
                <button type="button" className="icon-btn -mr-2 -mt-1" onClick={close} disabled={busy} aria-label="Close">
                  <CloseIcon />
                </button>
              </div>

              <ul className="mt-5 flex flex-wrap gap-3">
                <AnimatePresence initial={false}>
                  {picked.map((p, index) => (
                    <motion.li
                      key={p.id}
                      layout
                      className="print relative p-1.5"
                      initial={{ opacity: 0, y: -28, scale: 1.12, rotate: TILTS[index % TILTS.length] * 3 }}
                      animate={{ opacity: 1, y: 0, scale: 1, rotate: TILTS[index % TILTS.length] }}
                      exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.15 } }}
                      transition={{ type: 'spring', stiffness: 360, damping: 22 }}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={p.url} alt={p.file.name} className="h-20 w-20 rounded-[2px] object-cover sm:h-24 sm:w-24" />
                      <button
                        type="button"
                        className="absolute -right-2 -top-2 grid h-6 w-6 place-items-center rounded-full border border-line bg-surface text-muted shadow-print hover:text-head"
                        onClick={() => remove(p.id)}
                        disabled={busy}
                        aria-label={`Remove ${p.file.name}`}
                      >
                        <CloseIcon size={12} />
                      </button>
                    </motion.li>
                  ))}
                </AnimatePresence>
                {picked.length < MAX_IMAGES_COMPRESSED && (
                  <li>
                    <button
                      type="button"
                      className="grid h-[5.75rem] w-[5.75rem] place-items-center rounded-[4px] border border-dashed border-muted/60 text-muted transition-colors hover:border-head hover:text-head sm:h-[6.75rem] sm:w-[6.75rem]"
                      onClick={() => input.current?.click()}
                      disabled={busy}
                      aria-label="Add more images"
                    >
                      <PlusIcon size={22} />
                    </button>
                  </li>
                )}
              </ul>

              <div className="mt-6 space-y-4 border-t border-line pt-5">
                <div className="flex items-center justify-between gap-4">
                  <div>
                    <p className="font-medium text-head">Recreate as</p>
                    <p className="text-sm text-muted">
                      {mode === 'web' ? 'A prompt for building a website in this look.' : 'A prompt for generating images in this style.'}
                    </p>
                  </div>
                  <Segmented
                    label="Recreate as"
                    value={mode}
                    onChange={setMode}
                    options={[
                      { value: 'web', label: 'Website' },
                      { value: 'image', label: 'Image' },
                    ]}
                  />
                </div>

                {picked.length > 1 && (
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-medium text-head">Compress</p>
                      <p className="text-sm text-muted">
                        {forced
                          ? 'More than three images are always sent as contact sheets.'
                          : 'Send the images together on one contact sheet: faster, a little less detail each.'}
                      </p>
                    </div>
                    <Switch label="Compress" checked={compressed} onChange={setCompress} disabled={forced || busy} />
                  </div>
                )}
              </div>

              <p className={`mt-5 text-sm ${summary.blocked && picked.length > 0 ? 'text-danger' : 'text-muted'}`}>{summary.text}</p>

              <div className="mt-5 flex justify-end gap-2">
                <button type="button" className="btn" onClick={close} disabled={busy}>
                  Cancel
                </button>
                <button type="button" className="btn btn-primary" onClick={submit} disabled={busy || summary.blocked}>
                  {busy ? 'Adding…' : 'Analyse'}
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </UploadContext.Provider>
  );
}

export function useUpload(): UploadApi {
  const api = useContext(UploadContext);
  if (!api) throw new Error('useUpload needs an UploadProvider above it.');
  return api;
}
