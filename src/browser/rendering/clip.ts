import type { DomElement } from './dom-tree';

// ── Clipping (CSS 2.2 §11.1.1 overflow, §11.1.2 clip) ─────────────────────

export interface ClipBox { x: number; y: number; w: number; h: number }
/** A clip with no area: the element is fully hidden (e.g. the `clip: rect(1px,1px,1px,1px)` screen-reader pattern). */
export const EMPTY_CLIP: ClipBox = { x: 0, y: 0, w: 0, h: 0 };

function intersectClip(a: ClipBox | null, b: ClipBox | null): ClipBox | null {
  if (!a) return b;
  if (!b) return a;
  if (a === EMPTY_CLIP || b === EMPTY_CLIP) return EMPTY_CLIP;
  const x = Math.max(a.x, b.x), y = Math.max(a.y, b.y);
  const x1 = Math.min(a.x + a.w, b.x + b.w), y1 = Math.min(a.y + a.h, b.y + b.h);
  return x1 > x && y1 > y ? { x, y, w: x1 - x, h: y1 - y } : EMPTY_CLIP;
}

/** The padding box when `overflow` is not visible (html/body overflow belongs to the viewport). */
export function overflowClipRect(el: DomElement): ClipBox | null {
  const tag = el.tagName.toLowerCase();
  if (tag === 'html' || tag === 'body') return null;
  const style = el.computedStyle;
  const b = el.layoutBox;
  if (!style || !b) return null;
  const ox = style.get('overflow-x') ?? style.get('overflow') ?? 'visible';
  const oy = style.get('overflow-y') ?? ox;
  if (ox === 'visible' && oy === 'visible') return null;
  const x = b.x + b.borderLeft, y = b.y + b.borderTop;
  const w = b.width - b.borderLeft - b.borderRight, h = b.height - b.borderTop - b.borderBottom;
  return w > 0 && h > 0 ? { x, y, w, h } : EMPTY_CLIP;
}

/** `clip: rect(top, right, bottom, left)` on an absolutely positioned box, relative to its border box. */
function cssClipRect(el: DomElement): ClipBox | null {
  const m = /^rect\(\s*([^,\s]+)[\s,]+([^,\s]+)[\s,]+([^,\s]+)[\s,]+([^,\s)]+)\s*\)$/i.exec((el.computedStyle?.get('clip') ?? '').trim());
  const b = el.layoutBox;
  if (!m || !b) return null;
  const edge = (v: string, auto: number): number => (v === 'auto' ? auto : parseFloat(v) || 0);
  const top = edge(m[1], 0), right = edge(m[2], b.width), bottom = edge(m[3], b.height), left = edge(m[4], 0);
  return right > left && bottom > top ? { x: b.x + left, y: b.y + top, w: right - left, h: bottom - top } : EMPTY_CLIP;
}

/**
 * Everything that clips an element from outside: the overflow of each ancestor in its
 * containing-block chain (an absolute box escapes non-positioned ancestors, a fixed box escapes
 * all but transformed ones) and `clip` on absolutely positioned boxes, its own included.
 */
export function clipFromAncestors(el: DomElement): ClipBox | null {
  const positionOf = (n: DomElement): string => n.computedStyle?.get('position') ?? 'static';
  let escaping = positionOf(el);
  let rect: ClipBox | null = escaping === 'absolute' || escaping === 'fixed' ? cssClipRect(el) : null;
  for (let a = el.parent as DomElement | null; a && a.nodeType === 'element'; a = a.parent as DomElement | null) {
    if (rect === EMPTY_CLIP) return rect;
    const pos = positionOf(a);
    if (escaping === 'fixed') {
      const t = a.computedStyle?.get('transform');
      if (!t || t === 'none') continue;
    } else if (escaping === 'absolute' && pos === 'static') {
      continue;
    }
    escaping = pos === 'absolute' || pos === 'fixed' ? pos : 'static';
    rect = intersectClip(rect, overflowClipRect(a));
    if (escaping !== 'static') rect = intersectClip(rect, cssClipRect(a));
  }
  return rect;
}
