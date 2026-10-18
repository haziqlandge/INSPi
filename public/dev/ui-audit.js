// INSPi UI audit: run in the page with
//   (await import('/dev/ui-audit.js')).audit()
// It measures what "looks wrong" used to be judged by eye: visible scrollbars, sideways
// overflow, text that is hard to read, SVG text drawn at the wrong scale, and overlays that
// leave the screen. Pure DOM, no app imports. Served by the dev server from public/dev.

/** A computed CSS colour as [r, g, b, alpha]; null when it cannot be read. */
export function parseColor(value) {
  const s = String(value).trim();
  if (s === 'transparent') return [0, 0, 0, 0];
  let m = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(s);
  if (m) {
    const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number.parseFloat(m[4]) / 100 : Number(m[4]);
    return [Number(m[1]), Number(m[2]), Number(m[3]), a];
  }
  m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/.exec(s);
  if (m) return [Math.round(m[1] * 255), Math.round(m[2] * 255), Math.round(m[3] * 255), m[4] === undefined ? 1 : Number(m[4])];
  return null;
}

/** `top` laid over the opaque colour `bottom`. */
export function blend(top, bottom) {
  const a = top[3];
  return [0, 1, 2].map((i) => Math.round(top[i] * a + bottom[i] * (1 - a))).concat(1);
}

function luminance([r, g, b]) {
  const lin = (c) => {
    const v = c / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio of two opaque colours. */
export function contrastRatio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Whether a rect leaves the viewport or comes within `margin` px of its edge. */
export function nearEdge(rect, view, margin) {
  return rect.left < margin || rect.top < margin || rect.right > view.width - margin || rect.bottom > view.height - margin;
}

function path(el) {
  const parts = [];
  for (let node = el; node && node.nodeType === 1 && parts.length < 3; node = node.parentElement) {
    let part = node.tagName.toLowerCase();
    if (node.id) part += `#${node.id}`;
    const cls = [...node.classList].filter((c) => !c.includes(':') && !c.includes('[')).slice(0, 2);
    if (cls.length) part += `.${cls.join('.')}`;
    parts.unshift(part);
  }
  return parts.join(' > ');
}

function visible(el) {
  const cs = getComputedStyle(el);
  if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
  const r = el.getBoundingClientRect();
  // Screen-reader-only text is 1×1 px
  return r.width > 1 && r.height > 1;
}

/** The rect of the element's first line of its own text. */
function textRect(el) {
  const node = [...el.childNodes].find((n) => n.nodeType === 3 && n.textContent.trim());
  if (!node) return null;
  const range = document.createRange();
  range.selectNodeContents(node);
  return range.getClientRects()[0] ?? null;
}

const covers = (outer, inner) => outer.left <= inner.left + 1 && outer.top <= inner.top + 1 && outer.right >= inner.right - 1 && outer.bottom >= inner.bottom - 1;

/**
 * The opaque colour painted behind an element's text, or null when an image sits behind it.
 * On screen it samples the stack at the text itself; off screen it walks the ancestors, and
 * counts an absolutely placed earlier sibling that covers the text (a sliding pill) as a layer.
 */
function backdrop(el) {
  const r = textRect(el);
  const onScreen = r && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth;
  const chain = onScreen ? document.elementsFromPoint(r.left + r.width / 2, r.top + r.height / 2) : [];
  // Covered by something else (the floating dock, an open dialog), or clipped away inside a scrolling
  // box so that only its ancestors are under the point: not readable here, so not judged here
  if (chain.length && chain[0] !== el && !el.contains(chain[0])) return null;
  if (!chain.length) {
    for (let node = el; node; node = node.parentElement) {
      chain.push(node);
      for (let sib = node.previousElementSibling; r && sib; sib = sib.previousElementSibling) {
        if (getComputedStyle(sib).position === 'absolute' && covers(sib.getBoundingClientRect(), r)) chain.push(sib);
      }
    }
  }
  const layers = [];
  for (const node of chain) {
    const cs = getComputedStyle(node);
    if (cs.backgroundImage && cs.backgroundImage !== 'none') return null;
    const c = parseColor(cs.backgroundColor);
    if (c && c[3] > 0) {
      layers.push(c);
      if (c[3] >= 1) break;
    }
  }
  let base = [255, 255, 255, 1];
  if (!layers.length || layers[layers.length - 1][3] < 1) {
    const root = parseColor(getComputedStyle(document.body).backgroundColor);
    if (root && root[3] >= 1) base = root;
  }
  return layers.reverse().reduce((under, layer) => blend(layer, under), base);
}

function ownText(el) {
  return [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
}

/** A copy of every `:hover` rule keyed to the class `__hover`, so a hover can be put on any element and measured. */
function hoverSheet() {
  const lines = [];
  const walk = (rules) => {
    for (const rule of rules) {
      if (rule.cssRules && !rule.selectorText) {
        const inner = [];
        const saved = lines.length;
        walk(rule.cssRules);
        inner.push(...lines.splice(saved));
        // Keep each copy in its own layer and media query: an unlayered copy would beat every
        // layered rule whatever its specificity, and measure a cascade the page does not have
        if (!inner.length) continue;
        if (rule.constructor.name === 'CSSLayerBlockRule') lines.push(`@layer ${rule.name}{${inner.join('')}}`);
        else if (rule.constructor.name === 'CSSMediaRule') lines.push(`@media ${rule.conditionText}{${inner.join('')}}`);
        else if (rule.constructor.name === 'CSSSupportsRule') lines.push(`@supports ${rule.conditionText}{${inner.join('')}}`);
        else lines.push(...inner);
      } else if (rule.selectorText && rule.selectorText.includes(':hover')) {
        lines.push(`${rule.selectorText.replaceAll(':hover', '.__hover')}{${rule.style.cssText}}`);
      }
    }
  };
  for (const sheet of document.styleSheets) {
    try {
      walk(sheet.cssRules);
    } catch {
      // a sheet from another origin cannot be read
    }
  }
  const style = document.createElement('style');
  style.textContent = lines.join('\n');
  return style;
}

/**
 * Every selected control (pressed, checked, current) with the contrast of its own text against its
 * own fill, as drawn and as drawn under the pointer.
 */
export function selectedContrast() {
  const sheet = hoverSheet();
  const freeze = document.createElement('style');
  freeze.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.append(sheet, freeze);
  const out = [];
  try {
    for (const el of document.querySelectorAll('[aria-pressed="true"],[aria-checked="true"],[aria-current]:not([aria-current="false"])')) {
      if (!visible(el)) continue;
      const texts = [el, ...el.querySelectorAll('*')].filter((n) => ownText(n));
      if (!texts.length) continue;
      const measure = () =>
        Math.min(
          ...texts.map((t) => {
            const fg = parseColor(getComputedStyle(t).color);
            const bg = backdrop(t);
            // Hidden or covered here (a scrolled-away row): not judged
            return fg && bg ? contrastRatio(blend(fg, bg), bg) : 21;
          }),
        );
      const rest = measure();
      el.classList.add('__hover');
      const hovered = measure();
      el.classList.remove('__hover');
      out.push({ at: path(el), text: el.textContent.trim().slice(0, 30), rest: Number(rest.toFixed(2)), hovered: Number(hovered.toFixed(2)) });
    }
  } finally {
    sheet.remove();
    freeze.remove();
  }
  return out;
}

/** Every finding on the page as it is drawn now. */
export function audit({ margin = 16 } = {}) {
  // Measure end states, not a colour or size halfway through a transition
  const freeze = document.createElement('style');
  freeze.textContent = '*,*::before,*::after{transition:none!important}';
  document.head.appendChild(freeze);
  try {
    return measure(margin);
  } finally {
    freeze.remove();
  }
}

function measure(margin) {
  const view = { width: innerWidth, height: innerHeight };
  const scrollbars = [];
  const lowContrast = [];
  const scaledSvgText = [];
  const offscreen = [];

  for (const el of document.querySelectorAll('body *')) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);

    const scrolls = (o) => o === 'auto' || o === 'scroll';
    const barX = el.offsetHeight - el.clientHeight - parseFloat(cs.borderTopWidth) - parseFloat(cs.borderBottomWidth);
    const barY = el.offsetWidth - el.clientWidth - parseFloat(cs.borderLeftWidth) - parseFloat(cs.borderRightWidth);
    const overflowsX = scrolls(cs.overflowX) && el.scrollWidth > el.clientWidth + 1;
    const overflowsY = scrolls(cs.overflowY) && el.scrollHeight > el.clientHeight + 1;
    if ((overflowsX && barX > 0.5) || (overflowsY && barY > 0.5)) {
      scrollbars.push({ at: path(el), axis: overflowsX && barX > 0.5 ? 'x' : 'y' });
    }

    if (ownText(el) && !el.closest('[disabled],[aria-disabled="true"]')) {
      const fg = parseColor(cs.color);
      const bg = backdrop(el);
      if (fg && bg) {
        const size = parseFloat(cs.fontSize);
        const large = size >= 24 || (size >= 18.66 && Number(cs.fontWeight) >= 700);
        const ratio = contrastRatio(blend(fg, bg), bg);
        if (ratio < (large ? 3 : 4.5)) lowContrast.push({ at: path(el), text: el.textContent.trim().slice(0, 40), ratio: Number(ratio.toFixed(2)) });
      }
    }

    if (el.tagName.toLowerCase() === 'svg' && el.querySelector('text')) {
      const box = el.viewBox && el.viewBox.baseVal;
      if (box && box.width > 0) {
        const scale = el.getBoundingClientRect().width / box.width;
        if (Math.abs(scale - 1) > 0.02) scaledSvgText.push({ at: path(el), scale: Number(scale.toFixed(2)) });
      }
    }

    if (el.matches('[role="dialog"], .fx-lightbox img, [data-popover]')) {
      const r = el.getBoundingClientRect();
      if (nearEdge(r, view, el.matches('[role="dialog"]') && r.width >= view.width - 1 ? 0 : margin)) {
        offscreen.push({ at: path(el), rect: [r.left, r.top, r.right, r.bottom].map(Math.round) });
      }
    }
  }

  return {
    scrollbars,
    overflowX: document.documentElement.scrollWidth > innerWidth,
    lowContrast,
    scaledSvgText,
    offscreen,
  };
}
