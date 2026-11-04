/**
 * CSS `url()` images: `background-image` and `mask-image`.
 *
 * Nova painted only gradients for `background-image`. A `url()` layer was never loaded, so photos,
 * sprites and icons set from CSS were blank. Icons drawn as a `currentColor` background through an
 * SVG `mask-image` (MDN, Wikipedia) painted as solid squares, then (1.83) as nothing.
 *
 * After layout, each element's first `url()` per property is fetched and decoded once per URL and
 * size (an SVG is rasterized at the box size × DPR). The paint engine reads the results with
 * `cssImageFor`.
 */
import type { DomElement, DomNode } from './dom-tree';
import { boxChildren } from './dom-tree';

export type CssImageKind = 'background' | 'mask';
/** Loads and decodes one image; `size` is the device-pixel box an SVG is rasterized to. */
/** A decoded image and its natural size in CSS px (an SVG's pixels are its box × DPR). */
export interface CssImage { image: ImageData; width: number; height: number }
export type CssImageFetch = (url: string, size: { width: number; height: number }) => Promise<CssImage | null>;

const images = new WeakMap<DomElement, Partial<Record<CssImageKind, CssImage>>>();

/** The decoded image for `el`'s background or mask layer, once loaded. */
export function cssImageFor(el: DomElement, kind: CssImageKind): CssImage | undefined {
  return images.get(el)?.[kind];
}

/** The first `url(…)` in a CSS value, unquoted; null when there is none. */
export function firstCssUrl(value: string | undefined): string | null {
  if (!value || !value.includes('url(')) return null;
  const m = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)\s]*))\s*\)/i.exec(value);
  const url = m ? (m[1] ?? m[2] ?? m[3] ?? '') : '';
  return url && !url.startsWith('#') ? url : null;
}

function urlOf(style: ReadonlyMap<string, string>, kind: CssImageKind): string | null {
  if (kind === 'background') return firstCssUrl(style.get('background-image')) ?? firstCssUrl(style.get('background'));
  return firstCssUrl(style.get('mask-image')) ?? firstCssUrl(style.get('-webkit-mask-image')) ?? firstCssUrl(style.get('mask'));
}

/**
 * Loads every laid-out element's CSS images. Returns how many elements got a new image.
 * `cache` is shared across calls: each URL and size is fetched once per document.
 * ponytail: runs after the initial layout only; elements shown later keep what they had then.
 */
export async function loadCssImages(
  root: readonly DomNode[], fetch: CssImageFetch, dpr: number, baseUrl: string,
  cache: Map<string, Promise<CssImage | null>>,
): Promise<number> {
  const jobs: Promise<number>[] = [];
  const visit = (node: DomNode): void => {
    if (node.nodeType !== 'element') return;
    const el = node as DomElement;
    const style = el.computedStyle;
    if (!style || style.get('display') === 'none') return;
    const box = el.layoutBox;
    if (box && box.width > 0 && box.height > 0) {
      for (const kind of ['background', 'mask'] as const) {
        const raw = urlOf(style, kind);
        if (!raw) continue;
        let url: string;
        try { url = new URL(raw, baseUrl).toString(); } catch { continue; }
        const size = { width: Math.max(1, Math.round(box.width * dpr)), height: Math.max(1, Math.round(box.height * dpr)) };
        const key = `${size.width}x${size.height} ${url}`;
        let p = cache.get(key);
        if (!p) { p = fetch(url, size).catch(() => null); cache.set(key, p); }
        jobs.push(p.then((img) => {
          if (!img) return 0;
          const own = images.get(el) ?? {};
          if (own[kind] === img) return 0;
          own[kind] = img;
          images.set(el, own);
          el._dirtyPaint = true;
          return 1;
        }));
      }
    }
    for (const c of boxChildren(el)) visit(c);
  };
  for (const n of root) visit(n);
  return (await Promise.all(jobs)).reduce((a, b) => a + b, 0);
}

/** The bytes and MIME type of a `data:` URL (base64 or percent-encoded); null when malformed. */
export function decodeDataUrl(url: string): { bytes: Uint8Array; type: string } | null {
  const m = /^data:([^,]*?)(;base64)?,(.*)$/is.exec(url);
  if (!m) return null;
  const type = (m[1] || 'text/plain').split(';')[0]!.trim().toLowerCase();
  try {
    if (m[2]) {
      const bin = atob(m[3]!.replace(/\s+/g, ''));
      return { bytes: Uint8Array.from(bin, (c) => c.charCodeAt(0)), type };
    }
    return { bytes: new TextEncoder().encode(decodeURIComponent(m[3]!)), type };
  } catch {
    return null;
  }
}

const tinted = new WeakMap<ImageData, Map<string, ImageData>>();

/**
 * `mask` used as the alpha of a solid `color` (r, g, b, a 0–1): what a background colour looks
 * like through a mask image (CSS Masking, alpha mode). Cached per mask and colour.
 */
export function tintThroughMask(mask: ImageData, color: { r: number; g: number; b: number; a: number }): ImageData {
  const key = `${color.r},${color.g},${color.b},${color.a}`;
  let byColor = tinted.get(mask);
  if (!byColor) { byColor = new Map(); tinted.set(mask, byColor); }
  const hit = byColor.get(key);
  if (hit) return hit;
  const src = mask.data;
  const out = new Uint8ClampedArray(src.length);
  for (let i = 0; i < src.length; i += 4) {
    out[i] = color.r; out[i + 1] = color.g; out[i + 2] = color.b;
    out[i + 3] = src[i + 3]! * color.a;
  }
  const img = { data: out, width: mask.width, height: mask.height, colorSpace: 'srgb' } as unknown as ImageData;
  byColor.set(key, img);
  return img;
}
