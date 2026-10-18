'use client';

/* FX-INDEX:START
HealthDot — pulsing dot for a model's health: green healthy, amber degraded, grey unknown — line 31 — recreated (status-dot pattern)
DevelopReveal — darkroom print: while waiting a scan line sweeps warm paper; when the image lands a grid of paper squares dissolves at random while sepia and blur wash out — line 42 — recreated from React Bits Pixel Transition (GSAP) with anime.js + INSPi's developing scan
ShutterButton — button with a six-blade camera iris: the blades snap shut and open on press and turn slowly while busy — line 145 — recreated (camera aperture, SVG + anime.js)
RenderCarousel — row of prints with no scrollbar: arrows in the heading row glide one print at a time, autoplay does exactly that every 4 s and glides back from the end, pausing while hovered, focused, dragged, zoomed, hidden or off screen; edges fade where more prints wait; mouse drag, touch swipe and ← →; a print grows into the zoom view with arrows across all of them — line 216 — recreated (snap carousel after Embla, anime.js glide) + UI Layouts media-modal
PrintLightbox — zoom view of a list of prints: the one opened flies out of its thumbnail and back into it above a backdrop that fades on its own, arrows, ← → and a swipe move through the list with a cross-fade, a counter says where you are; never larger than the screen allows, with an optional side panel; Escape or a click closes it, and over a dialog only it closes — line 618 — recreated from UI Layouts media-modal
CyclingPlaceholder — ghost text over an empty field that types an example, holds, backspaces and types the next — line 758 — recreated (typewriter placeholder after React Bits Text Type, no dependency)
AspectPicker — aspect-ratio choices drawn as small frames of that shape; a filled frame springs to the one picked — line 802 — recreated (Motion layoutId, after INSPi Segmented)
MasonryWall — column wall of prints that rise in with a short stagger; the newest develops in, any print opens in PrintLightbox — line 827 — recreated (INSPi gallery wall + DevelopReveal)
LockToggle — padlock whose shackle lifts open and snaps shut with a spring — line 883 — recreated (Coolors-style lock, Motion)
SwatchColumn — one full-height colour of a palette; when it changes, a slot-machine reel of passing colours spins down and settles with an overshoot; hex, lock and copy float on top — line 914 — recreated from Coolors' generator (studied frame by frame) with an anime.js reel
FX-INDEX:END */

// INSPi's own motion pieces, one file so they can be found from the index above.
// Each component starts with a `/** @fx Name | what it does | source */` tag; `npm run fx:index`
// rebuilds the index from those tags. Everything respects prefers-reduced-motion.

import { animate, stagger } from 'animejs';
import { AnimatePresence, motion, usePresence } from 'motion/react';
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { ChevronLeftIcon, ChevronRightIcon, CloseIcon } from '@/components/ui/icons';
import { AUTOPLAY_MS, autoplayTarget, canAutoplay, indexAt, stepIndex } from './carousel-nav';
import { keyAction, neighbours, swipeStep } from './lightbox-nav';
import { Portal } from '@/components/ui/portal';
import './fx.css';

const reducedMotion = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** @fx HealthDot | pulsing dot for a model's health: green healthy, amber degraded, grey unknown | recreated (status-dot pattern) */
export function HealthDot({ health, title }: { health: 'healthy' | 'degraded' | 'unknown'; title?: string }) {
  const color = health === 'healthy' ? 'var(--ok)' : health === 'degraded' ? 'var(--warn)' : 'var(--muted)';
  return (
    <span className="fx-health" role="img" aria-label={title ?? health} title={title ?? health} style={{ '--dot': color } as CSSProperties}>
      {health !== 'unknown' && <span className="fx-health-ring" aria-hidden />}
    </span>
  );
}

/**
 * @fx DevelopReveal | darkroom print: while waiting a scan line sweeps warm paper; when the image lands a grid of paper squares dissolves at random while sepia and blur wash out | recreated from React Bits Pixel Transition (GSAP) with anime.js + INSPi's developing scan
 */
export function DevelopReveal({
  src,
  alt,
  width,
  height,
  grid = 9,
  className = '',
}: {
  /** Null while the image is being made. */
  src: string | null;
  alt: string;
  width: number;
  height: number;
  grid?: number;
  className?: string;
}) {
  const imgRef = useRef<HTMLImageElement>(null);
  const cellsRef = useRef<HTMLDivElement>(null);
  // Which src has loaded and which has finished developing. Keyed by src (not reset in an
  // effect), so a cached image whose load lands before effects run is not forgotten.
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const [doneSrc, setDoneSrc] = useState<string | null>(null);
  const loaded = src !== null && loadedSrc === src;
  const done = src !== null && doneSrc === src;
  const rows = Math.max(3, Math.round((grid * height) / width));

  // A cached image can be complete before React sees its load event
  useLayoutEffect(() => {
    const img = imgRef.current;
    if (src && img?.complete && img.naturalWidth > 0) setLoadedSrc(src);
  }, [src]);

  useEffect(() => {
    if (!loaded || done || !src) return;
    const img = imgRef.current;
    const cells = cellsRef.current?.children;
    const finish = () => {
      // The print always ends sharp, whatever interrupted the wash
      if (img) img.style.removeProperty('filter');
      setDoneSrc(src);
    };
    // Nobody to show it to (reduced motion, or a hidden tab whose frames are paused): just show it
    if (!img || !cells || reducedMotion() || document.visibilityState === 'hidden') {
      finish();
      return;
    }
    const wash = animate(img, {
      filter: ['sepia(0.9) blur(14px) contrast(0.75) brightness(1.15)', 'sepia(0) blur(0px) contrast(1) brightness(1)'],
      duration: 1500,
      ease: 'outQuart',
    });
    const dissolve = animate(cells, {
      opacity: [1, 0],
      scale: [1, 0.6],
      duration: 260,
      ease: 'outQuad',
      delay: stagger(26, { grid: [grid, rows], from: 'random' }),
    });
    // Done when both have played out, or after a safety margin if frames stalled (a background tab)
    let settled = false;
    const settle = () => {
      if (settled) return;
      settled = true;
      finish();
    };
    void Promise.all([wash.then(() => undefined), dissolve.then(() => undefined)]).then(settle);
    const safety = setTimeout(settle, 2600);
    const hidden = () => document.visibilityState === 'hidden' && settle();
    document.addEventListener('visibilitychange', hidden);
    return () => {
      clearTimeout(safety);
      document.removeEventListener('visibilitychange', hidden);
      // revert, not cancel: a cancelled wash would freeze the blur where it stood
      wash.revert();
      dissolve.revert();
    };
  }, [loaded, done, src, grid, rows]);

  return (
    <div className={`fx-develop ${className}`} style={{ aspectRatio: `${width} / ${height}` }}>
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element -- stored WebP served by our own route
        <img ref={imgRef} src={src} alt={alt} className="fx-develop-img" onLoad={() => setLoadedSrc(src)} />
      ) : (
        <div className="fx-develop-wait" aria-label="Developing" role="status">
          <span className="fx-develop-scan" aria-hidden />
          <span className="fx-develop-label">Developing…</span>
        </div>
      )}
      {src && !done && (
        <div ref={cellsRef} className="fx-develop-cells" style={{ gridTemplateColumns: `repeat(${grid}, 1fr)`, gridTemplateRows: `repeat(${rows}, 1fr)` }} aria-hidden>
          {Array.from({ length: grid * rows }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * @fx ShutterButton | button with a six-blade camera iris: the blades snap shut and open on press and turn slowly while busy | recreated (camera aperture, SVG + anime.js)
 */
export function ShutterButton({
  children,
  busy,
  disabled,
  onClick,
  variant = 'primary',
  type = 'button',
}: {
  children: ReactNode;
  busy?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  variant?: 'primary' | 'plain';
  type?: 'button' | 'submit';
}) {
  const irisRef = useRef<SVGGElement>(null);

  // A slow turn while the image is being made.
  useEffect(() => {
    const iris = irisRef.current;
    if (!busy || !iris || reducedMotion()) return;
    const spin = animate(iris, { rotate: '+=360', duration: 2400, ease: 'linear', loop: true });
    return () => {
      spin.cancel();
      iris.style.transform = '';
    };
  }, [busy]);

  function press() {
    const blades = irisRef.current?.querySelectorAll('path');
    if (blades && !reducedMotion()) {
      animate(blades, {
        translateX: [0, 2.6, 0],
        duration: 420,
        ease: 'inOutQuad',
        delay: stagger(18),
      });
    }
    onClick?.();
  }

  return (
    <button type={type} className={`btn ${variant === 'primary' ? 'btn-primary' : ''} fx-shutter`} onClick={press} disabled={disabled || busy} aria-busy={busy}>
      <svg width="18" height="18" viewBox="-12 -12 24 24" aria-hidden="true" className="fx-shutter-iris">
        <circle r="10.5" fill="none" stroke="currentColor" strokeWidth="1.5" />
        <g ref={irisRef} style={{ transformOrigin: '0 0' }}>
          {Array.from({ length: 6 }, (_, i) => (
            <path key={i} d="M 0 -10 L 3.4 -3.6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" transform={`rotate(${i * 60})`} />
          ))}
        </g>
      </svg>
      {children}
    </button>
  );
}

export interface StripItem {
  id: string;
  src: string;
  width: number;
  height: number;
  alt: string;
  caption: ReactNode;
}

/** One glide between prints: the arrows and autoplay share it, so both feel the same. */
const GLIDE_MS = 560;

/**
 * @fx RenderCarousel | row of prints with no scrollbar: arrows in the heading row glide one print at a time, autoplay does exactly that every 4 s and glides back from the end, pausing while hovered, focused, dragged, zoomed, hidden or off screen; edges fade where more prints wait; mouse drag, touch swipe and ← →; a print grows into the zoom view with arrows across all of them | recreated (snap carousel after Embla, anime.js glide) + UI Layouts media-modal
 */
export function RenderCarousel({
  items,
  pending,
  actions,
  heading,
  extra,
  notice,
  height = 240,
}: {
  items: StripItem[];
  /** A print still developing, shown first. */
  pending?: { width: number; height: number } | null;
  /** Extra controls under a print, e.g. delete. */
  actions?: (item: StripItem) => ReactNode;
  /** The heading row's left side; the arrows and counter sit on its right. */
  heading: ReactNode;
  /** Beside the arrows, e.g. the image model's "change" link. */
  extra?: ReactNode;
  /** Between the heading row and the prints, e.g. an error. */
  notice?: ReactNode;
  height?: number;
}) {
  const track = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const fresh = useFreshId(items);
  const [pos, setPos] = useState({ index: 0, atStart: true, atEnd: true, fits: true });
  const live = useRef({ pos, open, hovering: false, focused: false, dragging: false, offscreen: false, last: 0 });
  live.current.pos = pos;
  live.current.open = open;
  const glide = useRef<{ cancel: () => void } | null>(null);
  const lead = pending ? 1 : 0;
  const count = items.length + lead;

  /** Each print's left edge, measured from the first print's. */
  const starts = useCallback(() => {
    const el = track.current;
    const first = el?.firstElementChild as HTMLElement | null;
    if (!el || !first) return [];
    return [...el.children].map((li) => (li as HTMLElement).offsetLeft - first.offsetLeft);
  }, []);

  const measure = useCallback(() => {
    const el = track.current;
    if (!el || !el.firstElementChild) return;
    const max = el.scrollWidth - el.clientWidth;
    setPos({ index: indexAt(el.scrollLeft, starts()), atStart: el.scrollLeft <= 2, atEnd: el.scrollLeft >= max - 2, fits: max <= 2 });
  }, [starts]);

  const glideTo = useCallback(
    (index: number) => {
      const el = track.current;
      if (!el) return;
      const to = Math.min(el.scrollWidth - el.clientWidth, starts()[index] ?? 0);
      glide.current?.cancel();
      if (reducedMotion()) {
        el.scrollLeft = to;
        measure();
        return;
      }
      // Snapping is off for the glide itself, or it would fight every frame. A data attribute,
      // not a class: React rewrites the class list when the edge fades change mid-glide.
      el.dataset.gliding = '';
      const box = { x: el.scrollLeft };
      const anim = animate(box, {
        x: to,
        duration: GLIDE_MS,
        ease: 'outQuart',
        onUpdate: () => {
          el.scrollLeft = box.x;
        },
        onComplete: () => {
          el.scrollLeft = to;
          delete el.dataset.gliding;
          measure();
        },
      });
      glide.current = {
        cancel: () => {
          anim.cancel();
          delete el.dataset.gliding;
        },
      };
    },
    [measure, starts],
  );

  const touch = () => (live.current.last = Date.now());
  const step = (dir: 1 | -1) => {
    touch();
    const p = live.current.pos;
    if ((dir === 1 && p.atEnd) || (dir === -1 && p.atStart)) return;
    const to = stepIndex(p.index, count, dir);
    if (to !== null) glideTo(to);
  };

  // Measure on resize and whenever the prints change
  useLayoutEffect(() => {
    measure();
    const el = track.current;
    if (!el) return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, [measure, items.length, pending]);

  // A new print slides in first, and develops before autoplay moves again
  useEffect(() => {
    if (!fresh && !pending) return;
    live.current.last = Date.now() + 2600;
    glideTo(0);
  }, [fresh, pending, glideTo]);

  // Off screen, nothing moves
  useEffect(() => {
    const el = track.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => (live.current.offscreen = !entry.isIntersecting));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Autoplay: one glide every AUTOPLAY_MS, exactly what the next arrow does; back to the first from the end
  useEffect(() => {
    const timer = window.setInterval(() => {
      const s = live.current;
      const ok = canAutoplay({
        hovering: s.hovering,
        focused: s.focused,
        dragging: s.dragging,
        zoomed: s.open !== null,
        hidden: document.visibilityState === 'hidden',
        offscreen: s.offscreen,
        reducedMotion: reducedMotion(),
        fits: s.pos.fits,
        idleMs: Date.now() - s.last,
      });
      if (ok) glideTo(autoplayTarget(s.pos.index, count, s.pos.atEnd));
    }, AUTOPLAY_MS);
    return () => window.clearInterval(timer);
  }, [count, glideTo]);

  // Mouse drag; touch scrolls natively
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);
  const onPointerDown = (event: React.PointerEvent<HTMLUListElement>) => {
    if (event.pointerType !== 'mouse' || event.button !== 0 || !track.current) return;
    glide.current?.cancel();
    drag.current = { x: event.clientX, left: track.current.scrollLeft, moved: false };
    live.current.dragging = true;
  };
  const onPointerMove = (event: React.PointerEvent<HTMLUListElement>) => {
    const d = drag.current;
    const el = track.current;
    if (!d || !el) return;
    const dx = event.clientX - d.x;
    if (!d.moved && Math.abs(dx) > 5) {
      d.moved = true;
      el.dataset.dragging = '';
      el.setPointerCapture(event.pointerId);
    }
    if (d.moved) el.scrollLeft = d.left - dx;
  };
  const endDrag = () => {
    const d = drag.current;
    const el = track.current;
    live.current.dragging = false;
    touch();
    if (!d || !el) return;
    delete el.dataset.dragging;
    if (d.moved) {
      // Settle on the print nearest the left edge
      const s = starts();
      const nearest = s.reduce((best, start, i) => (Math.abs(start - el.scrollLeft) < Math.abs(s[best] - el.scrollLeft) ? i : best), 0);
      glideTo(nearest);
    }
    window.setTimeout(() => (drag.current = null), 0);
  };

  const shown = Math.min(items.length, Math.max(1, pos.index - lead + 1));
  const arrows = !pos.fits && (
    <div className="fx-carousel-controls">
      <span className="fx-carousel-count" aria-live="polite">
        {shown} of {items.length}
      </span>
      <button type="button" className="icon-btn fx-carousel-arrow" aria-label="Previous render" disabled={pos.atStart} onClick={() => step(-1)}>
        <ChevronLeftIcon size={16} />
      </button>
      <button type="button" className="icon-btn fx-carousel-arrow" aria-label="Next render" disabled={pos.atEnd} onClick={() => step(1)}>
        <ChevronRightIcon size={16} />
      </button>
    </div>
  );

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
        {heading}
        <div className="flex items-center gap-3">
          {extra}
          {arrows}
        </div>
      </div>
      {notice}
      <ul
        ref={track}
        className={`fx-carousel mt-5 ${pos.atStart ? '' : 'fade-left'} ${pos.atEnd ? '' : 'fade-right'}`}
        style={{ '--strip-h': `${height}px` } as CSSProperties}
        tabIndex={pos.fits ? -1 : 0}
        aria-label="Renders"
        onScroll={measure}
        onPointerEnter={() => (live.current.hovering = true)}
        onPointerLeave={() => {
          live.current.hovering = false;
          touch();
        }}
        onFocus={() => (live.current.focused = true)}
        onBlur={() => {
          live.current.focused = false;
          touch();
        }}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') {
            event.preventDefault();
            step(event.key === 'ArrowRight' ? 1 : -1);
          }
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={(event) => {
          // A drag is not a click on the print under it
          if (drag.current?.moved) {
            event.stopPropagation();
            event.preventDefault();
          }
        }}
      >
        {pending && (
          <li className="fx-strip-item" style={{ width: `calc(var(--strip-h) * ${pending.width / pending.height})` }}>
            <DevelopReveal src={null} alt="" width={pending.width} height={pending.height} className="rounded-xl" />
            <p className="fx-strip-caption">Developing</p>
          </li>
        )}
        {items.map((item, i) => (
          <li key={item.id} className="fx-strip-item" style={{ width: `calc(var(--strip-h) * ${item.width / item.height})` }}>
            <motion.button
              type="button"
              data-print={`fx-strip-${item.id}`}
              className="fx-strip-print"
              onClick={() => setOpen(i)}
              aria-label={`Open ${item.alt}`}
              whileHover={{ y: -6, rotate: -0.6 }}
              transition={{ type: 'spring', stiffness: 260, damping: 18 }}
              draggable={false}
            >
              {item.id === fresh ? (
                <DevelopReveal src={item.src} alt={item.alt} width={item.width} height={item.height} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- stored WebP served by our own route
                <img src={item.src} alt={item.alt} loading="lazy" draggable={false} className="h-full w-full object-cover" />
              )}
            </motion.button>
            <div className="fx-strip-caption">
              {item.caption}
              {actions?.(item)}
            </div>
          </li>
        ))}
      </ul>
      <PrintLightbox items={items} index={open} onIndex={setOpen} layoutPrefix="fx-strip" onClose={close} />
    </>
  );
}

/** The id of the print that arrived after the list first rendered, so only it develops in. */
function useFreshId(items: { id: string }[]): string | null {
  const [fresh, setFresh] = useState<string | null>(null);
  const known = useRef<Set<string> | null>(null);
  useEffect(() => {
    if (known.current) {
      const arrived = items.find((item) => !known.current!.has(item.id));
      if (arrived) setFresh(arrived.id);
    }
    known.current = new Set(items.map((item) => item.id));
  }, [items]);
  return fresh;
}

const FLIGHT_EASE = 'cubic-bezier(.32,.72,0,1)';

/** The thumbnail a print was opened from: whatever carries `data-print="<prefix>-<id>"`. */
function thumbOf(prefix: string, id: string): HTMLElement | null {
  return document.querySelector<HTMLElement>(`[data-print="${CSS.escape(`${prefix}-${id}`)}"]`);
}

const onScreen = (rect: DOMRect) => rect.bottom > 0 && rect.right > 0 && rect.top < window.innerHeight && rect.left < window.innerWidth;

/**
 * One flight between a print's thumbnail and its place in the zoom view, as a single transform
 * animation on the big image: it starts where it is now (a close during the opening flight turns
 * round from there) and nothing else moves, so there is no second hand-over at the end.
 */
function fly(img: HTMLElement, thumb: HTMLElement, direction: 'open' | 'close'): Animation {
  const current = img.getBoundingClientRect();
  for (const running of img.getAnimations()) running.cancel();
  const home = img.getBoundingClientRect();
  const box = thumb.getBoundingClientRect();
  const place = (r: DOMRect) => `translate(${r.left - home.left}px, ${r.top - home.top}px) scale(${r.width / home.width}, ${r.height / home.height})`;
  // The corner radius is drawn unscaled, so the thumbnail's is divided by the scale it will be seen at
  const radius = parseFloat(getComputedStyle(thumb).borderTopLeftRadius) || 0;
  const small = `${radius / (box.width / home.width)}px`;
  const rest = { transform: 'translate(0px, 0px) scale(1, 1)', borderRadius: '1rem' };
  const thumbnail = { transform: place(box), borderRadius: small };
  const keyframes = direction === 'open' ? [thumbnail, rest] : [{ transform: place(current), borderRadius: '1rem' }, thumbnail];
  return img.animate(keyframes.map((k) => ({ ...k, transformOrigin: '0 0' })), {
    duration: direction === 'open' ? 380 : 320,
    easing: FLIGHT_EASE,
    fill: direction === 'open' ? 'backwards' : 'forwards',
  });
}

/**
 * The print in the zoom view: grows out of its thumbnail when it appears, and flies back into it
 * (above the fading backdrop) before it is taken away. The thumbnail is hidden while its print is out.
 */
function LightboxStage({ prefix, item, openedId, position, count }: { prefix: string; item: StripItem; openedId: string | null; position: number; count: number }) {
  const [present, safeToRemove] = usePresence();
  const frame = useRef<HTMLDivElement>(null);
  const hidden = useRef(new Set<HTMLElement>());
  const hide = (el: HTMLElement) => {
    el.style.visibility = 'hidden';
    hidden.current.add(el);
  };
  const reveal = () => {
    for (const el of hidden.current) el.style.visibility = '';
    hidden.current.clear();
  };
  const shown = () => frame.current?.querySelector<HTMLElement>('.fx-lightbox-img:last-of-type') ?? null;

  useLayoutEffect(() => {
    const thumb = thumbOf(prefix, item.id);
    const img = shown();
    if (!thumb || !img || reducedMotion() || !onScreen(thumb.getBoundingClientRect())) return;
    hide(thumb);
    fly(img, thumb, 'open');
    // Only the opening print flies; the effect must not run again as the list is stepped through
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (present) return;
    const img = shown();
    const thumb = thumbOf(prefix, item.id);
    reveal();
    if (!img || !thumb || reducedMotion() || !onScreen(thumb.getBoundingClientRect())) {
      // Nothing to land on (scrolled away, deleted): the print simply fades with the backdrop
      const fade = img?.animate({ opacity: [1, 0] }, { duration: 200, fill: 'forwards' });
      if (fade) void fade.finished.then(() => safeToRemove?.(), () => safeToRemove?.());
      else safeToRemove?.();
      return;
    }
    hide(thumb);
    const done = () => {
      reveal();
      safeToRemove?.();
    };
    void fly(img, thumb, 'close').finished.then(done, done);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [present]);

  return (
    <div className="fx-lightbox-stage">
      <div className="fx-lightbox-frame" ref={frame}>
        <AnimatePresence initial={false}>
          <motion.img
            key={item.id}
            src={item.src}
            alt={item.alt}
            className="fx-lightbox-img"
            style={{ aspectRatio: `${item.width} / ${item.height}` }}
            initial={item.id === openedId ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ opacity: { duration: 0.22 } }}
          />
        </AnimatePresence>
      </div>
      {count > 1 && (
        <motion.p className="fx-lightbox-count" aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
          {position + 1} / {count}
        </motion.p>
      )}
    </div>
  );
}

const CHROME_FADE = { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 }, transition: { duration: 0.2 } };

/**
 * @fx PrintLightbox | zoom view of a list of prints: the one opened flies out of its thumbnail and back into it above a backdrop that fades on its own, arrows, ← → and a swipe move through the list with a cross-fade, a counter says where you are; never larger than the screen allows, with an optional side panel; Escape or a click closes it, and over a dialog only it closes | recreated from UI Layouts media-modal
 */
export function PrintLightbox({
  items,
  index,
  onIndex,
  layoutPrefix,
  onClose,
  footer,
  layer = 'page',
}: {
  items: StripItem[];
  /** The print shown, or null while closed. */
  index: number | null;
  onIndex: (index: number) => void;
  layoutPrefix: string;
  onClose: () => void;
  /** Beside the print on wide screens (its prompt, actions). */
  footer?: (item: StripItem) => ReactNode;
  /** `page` sits under the dock; `dialog` sits over a dialog such as the New entry window. */
  layer?: 'page' | 'dialog';
}) {
  const item = index !== null ? (items[index] ?? null) : null;
  const count = items.length;
  // Only the print that was opened grows out of its thumbnail; moving on cross-fades.
  const [openedId, setOpenedId] = useState<string | null>(null);
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const isOpen = item !== null;
  if (!isOpen && openedId !== null) setOpenedId(null);
  if (isOpen && openedId === null) setOpenedId(item.id);

  useEffect(() => {
    if (!isOpen || index === null) return;
    const onKey = (event: KeyboardEvent) => {
      const action = keyAction(event.key, index, count);
      if (!action) return;
      // Captured first and stopped, so a dialog underneath keeps its own Escape for the next press
      event.preventDefault();
      event.stopImmediatePropagation();
      if ('close' in action) onClose();
      else onIndex(action.index);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [isOpen, index, count, onClose, onIndex]);

  useEffect(() => {
    if (!isOpen) return;
    // The scrollbar's width is kept as padding, so the page (and the thumbnail the print flies back to) does not move
    const { overflow, paddingRight } = document.body.style;
    const bar = window.innerWidth - document.documentElement.clientWidth;
    document.body.style.overflow = 'hidden';
    if (bar > 0) document.body.style.paddingRight = `${bar}px`;
    return () => {
      document.body.style.overflow = overflow;
      document.body.style.paddingRight = paddingRight;
    };
  }, [isOpen]);

  // The neighbours load while this one is looked at, so the next press shows at once
  useEffect(() => {
    if (index === null) return;
    const { prev, next } = neighbours(index, count);
    for (const i of [prev, next]) if (i !== null) new Image().src = items[i].src;
  }, [index, count, items]);

  const { prev, next } = index !== null ? neighbours(index, count) : { prev: null, next: null };
  const side = item && footer ? footer(item) : null;
  const step = (to: number | null) => (event: React.MouseEvent) => {
    event.stopPropagation();
    if (to !== null) onIndex(to);
  };

  return (
    <Portal>
      <AnimatePresence>
        {item && (
          <motion.div
            className={`fx-lightbox ${side ? 'fx-lightbox-split' : ''} ${layer === 'dialog' ? 'fx-lightbox-over-dialog' : ''}`}
            role="dialog"
            aria-modal="true"
            aria-label={count > 1 ? `${item.alt}, ${index! + 1} of ${count}` : item.alt}
            onClick={onClose}
            onPointerDown={(event) => (swipe.current = { x: event.clientX, y: event.clientY })}
            onPointerUp={(event) => {
              const start = swipe.current;
              swipe.current = null;
              if (!start || index === null) return;
              const dir = swipeStep(event.clientX - start.x, event.clientY - start.y);
              const to = dir === 1 ? next : dir === -1 ? prev : null;
              if (to !== null) {
                // A swipe is not a click: keep the view open
                event.preventDefault();
                swipe.current = { x: Number.NaN, y: Number.NaN };
                onIndex(to);
              }
            }}
            onClickCapture={(event) => {
              if (swipe.current && Number.isNaN(swipe.current.x)) {
                event.stopPropagation();
                swipe.current = null;
              }
            }}
          >
            {/* The backdrop fades on its own: the print is not under it, so it can fly back in plain sight */}
            <motion.div className="fx-lightbox-scrim" aria-hidden initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.28 }} />
            <LightboxStage prefix={layoutPrefix} item={item} openedId={openedId} position={index!} count={count} />
            {side && (
              <motion.aside
                className="fx-lightbox-side"
                onClick={(event) => event.stopPropagation()}
                initial={{ opacity: 0, x: 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: 24 }}
                transition={{ duration: 0.28, ease: [0.2, 0.7, 0.1, 1] }}
              >
                {side}
              </motion.aside>
            )}
            {prev !== null && (
              <motion.button type="button" className="icon-btn fx-lightbox-arrow fx-lightbox-prev" aria-label="Previous" onClick={step(prev)} {...CHROME_FADE}>
                <ChevronLeftIcon />
              </motion.button>
            )}
            {next !== null && (
              <motion.button type="button" className="icon-btn fx-lightbox-arrow fx-lightbox-next" aria-label="Next" onClick={step(next)} {...CHROME_FADE}>
                <ChevronRightIcon />
              </motion.button>
            )}
            <motion.button type="button" className="icon-btn fx-lightbox-close" aria-label="Close" onClick={onClose} {...CHROME_FADE}>
              <CloseIcon />
            </motion.button>
          </motion.div>
        )}
      </AnimatePresence>
    </Portal>
  );
}

/**
 * @fx CyclingPlaceholder | ghost text over an empty field that types an example, holds, backspaces and types the next | recreated (typewriter placeholder after React Bits Text Type, no dependency)
 */
export function CyclingPlaceholder({ examples, active }: { examples: string[]; active: boolean }) {
  const [text, setText] = useState('');

  useEffect(() => {
    if (!active || !examples.length) return;
    if (reducedMotion()) {
      setText(examples[0]);
      return;
    }
    let example = 0;
    let shown = 0;
    let deleting = false;
    let timer = 0;
    const tick = () => {
      const full = examples[example];
      shown += deleting ? -1 : 1;
      setText(full.slice(0, shown));
      let wait = deleting ? 16 : 36 + Math.random() * 40;
      if (!deleting && shown >= full.length) {
        deleting = true;
        wait = 2200;
      } else if (deleting && shown <= 0) {
        deleting = false;
        example = (example + 1) % examples.length;
        wait = 420;
      }
      timer = window.setTimeout(tick, wait);
    };
    timer = window.setTimeout(tick, 500);
    return () => window.clearTimeout(timer);
  }, [active, examples]);

  if (!active) return null;
  return (
    <span className="fx-cycling" aria-hidden>
      {text}
      <span className="fx-caret" />
    </span>
  );
}

/**
 * @fx AspectPicker | aspect-ratio choices drawn as small frames of that shape; a filled frame springs to the one picked | recreated (Motion layoutId, after INSPi Segmented)
 */
export function AspectPicker({ options, value, onChange }: { options: string[]; value: string; onChange: (value: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Aspect ratio" className="fx-aspect">
      {options.map((option) => {
        const [w, h] = option.split(':').map(Number);
        const scale = 20 / Math.max(w, h);
        const selected = option === value;
        return (
          <button key={option} type="button" role="radio" aria-checked={selected} className="fx-aspect-option" onClick={() => onChange(option)}>
            <span className="fx-aspect-box">
              <span className="fx-aspect-frame" style={{ width: w * scale, height: h * scale }}>
                {selected && <motion.span layoutId="fx-aspect-fill" className="fx-aspect-fill" transition={{ type: 'spring', stiffness: 480, damping: 32 }} />}
              </span>
            </span>
            <span className="fx-aspect-label">{option}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * @fx MasonryWall | column wall of prints that rise in with a short stagger; the newest develops in, any print opens in PrintLightbox | recreated (INSPi gallery wall + DevelopReveal)
 */
export function MasonryWall({
  items,
  pending,
  actions,
  footer,
}: {
  items: StripItem[];
  pending?: { width: number; height: number } | null;
  actions?: (item: StripItem) => ReactNode;
  /** Shown under the print in the lightbox, e.g. its prompt. */
  footer?: (item: StripItem, close: () => void) => ReactNode;
}) {
  const [open, setOpen] = useState<number | null>(null);
  const close = useCallback(() => setOpen(null), []);
  const fresh = useFreshId(items);
  return (
    <>
      <ul className="fx-masonry">
        {pending && (
          <li className="fx-masonry-item">
            <DevelopReveal src={null} alt="" width={pending.width} height={pending.height} className="fx-masonry-print" />
            <p className="fx-strip-caption">Developing</p>
          </li>
        )}
        {items.map((item, i) => (
          <motion.li
            key={item.id}
            className="fx-masonry-item"
            initial={{ opacity: 0, y: 18 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, ease: [0.2, 0.7, 0.1, 1], delay: Math.min(i, 12) * 0.035 }}
          >
            <motion.button type="button" data-print={`fx-wall-${item.id}`} className="fx-masonry-print" onClick={() => setOpen(i)} aria-label={`Open ${item.alt}`}>
              {item.id === fresh ? (
                <DevelopReveal src={item.src} alt={item.alt} width={item.width} height={item.height} />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element -- stored WebP served by our own route
                <img src={item.src} alt={item.alt} loading="lazy" width={item.width} height={item.height} className="block h-auto w-full" />
              )}
            </motion.button>
            <div className="fx-strip-caption">
              {item.caption}
              {actions?.(item)}
            </div>
          </motion.li>
        ))}
      </ul>
      <PrintLightbox items={items} index={open} onIndex={setOpen} layoutPrefix="fx-wall" onClose={close} footer={footer ? (item) => footer(item, close) : undefined} />
    </>
  );
}


/**
 * @fx LockToggle | padlock whose shackle lifts open and snaps shut with a spring | recreated (Coolors-style lock, Motion)
 */
export function LockToggle({ locked, onToggle, color = 'currentColor', label }: { locked: boolean; onToggle: () => void; color?: string; label: string }) {
  return (
    <button type="button" className="fx-lock" aria-pressed={locked} aria-label={label} title={label} onClick={onToggle} style={{ color }}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden>
        <rect x="5" y="11" width="14" height="9.5" rx="2.5" fill={locked ? 'currentColor' : 'none'} fillOpacity={0.18} />
        <motion.path
          d="M8.5 11V8a3.5 3.5 0 0 1 7 0v3"
          initial={false}
          animate={locked ? { y: 0, rotate: 0 } : { y: -2.5, rotate: -14 }}
          style={{ transformOrigin: '15.5px 11px', transformBox: 'view-box' }}
          transition={{ type: 'spring', stiffness: 700, damping: 14 }}
        />
      </svg>
    </button>
  );
}

/** Text that reads on top of a colour: dark ink on light colours, white on dark ones. */
export function inkOn(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16);
  const lin = (c: number) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  const y = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return y > 0.36 ? 'rgba(20, 16, 12, 0.86)' : 'rgba(255, 255, 255, 0.94)';
}

/**
 * @fx SwatchColumn | one full-height colour of a palette; when it changes, a slot-machine reel of passing colours spins down and settles with an overshoot; hex, lock and copy float on top | recreated from Coolors' generator (studied frame by frame) with an anime.js reel
 */
export function SwatchColumn({
  color,
  locked,
  onToggleLock,
  onCopy,
  rollId,
  delay = 0,
  passing,
}: {
  color: string;
  locked: boolean;
  onToggleLock: () => void;
  onCopy: () => void;
  /** Changes on every roll; the reel only spins when the colour changed with it. */
  rollId: number;
  delay?: number;
  /** Colours that flash past on the reel. */
  passing: string[];
}) {
  const reelRef = useRef<HTMLDivElement>(null);
  const previous = useRef(color);
  const [reel, setReel] = useState<string[] | null>(null);
  const [copied, setCopied] = useState(0);
  const ink = inkOn(color);

  // A click anywhere on the colour copies it; the lock and the hex keep their own jobs.
  function copy(event: React.MouseEvent) {
    if ((event.target as HTMLElement).closest('.fx-lock')) return;
    onCopy();
    setCopied((n) => n + 1);
  }

  useEffect(() => {
    if (!copied) return;
    const t = setTimeout(() => setCopied(0), 900);
    return () => clearTimeout(t);
  }, [copied]);

  // A new colour on a roll: stack old → passing → new and spin the stack into place.
  useEffect(() => {
    const from = previous.current;
    previous.current = color;
    if (from === color || reducedMotion()) return;
    setReel([color, ...passing.slice(0, 3), from]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rollId]);

  useEffect(() => {
    const el = reelRef.current;
    if (!reel || !el) return;
    const frames = reel.length;
    const spin = animate(el, {
      translateY: [`${(-(frames - 1) / frames) * 100}%`, '0%'],
      filter: ['blur(0px)', 'blur(5px)', 'blur(0px)'],
      duration: 760,
      delay,
      ease: 'outBack(1.3)',
      onComplete: () => setReel(null),
    });
    return () => {
      spin.cancel();
    };
  }, [reel, delay]);

  return (
    <div className="fx-swatch" style={{ background: color, color: ink }} onClick={copy} title={`Copy ${color}`}>
      {copied > 0 && (
        <span key={copied} className="fx-swatch-copied" aria-live="polite">
          Copied
        </span>
      )}
      {reel && (
        <div className="fx-swatch-reel" aria-hidden>
          <div ref={reelRef} className="fx-swatch-reel-strip" style={{ height: `${reel.length * 100}%`, transform: `translateY(${(-(reel.length - 1) / reel.length) * 100}%)` }}>
            {reel.map((c, i) => (
              <span key={i} style={{ background: c }} />
            ))}
          </div>
        </div>
      )}
      <div className="fx-swatch-ui">
        <button type="button" className="fx-swatch-hex" aria-label={`Copy ${color}`}>
          {color.replace('#', '').toUpperCase()}
        </button>
        <LockToggle locked={locked} onToggle={onToggleLock} label={locked ? 'Unlock this colour' : 'Lock this colour'} />
      </div>
    </div>
  );
}
