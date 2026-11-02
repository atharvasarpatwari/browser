/**
 * positioning.ts
 * ---------------------------------------------------------------------------
 * CSS Positioning scheme resolver for NovaBrowser's layout engine.
 * Implements: static | relative | absolute | fixed | sticky
 *
 * Design notes:
 * - Positioning is resolved in TWO passes over the layout tree:
 *     1. Normal-flow pass produces the "flow position" for every box,
 *        including relative/sticky ones.
 *     2. Out-of-flow pass (`resolveOutOfFlow`) repositions absolute/fixed
 *        boxes against their resolved containing block.
 * - `relative` and `sticky` never leave normal flow — they just get a final
 *   offset applied on top of their flow position (`applyInFlowOffset`).
 * - Sticky additionally needs a live scroll callback since its offset is
 *   scroll-dependent; see `StickyController`.
 *
 * Adapted to work with NovaBrowser's DomElement / LayoutBox types from
 * dom-tree.ts. Computed styles are read from ReadonlyMap<string, string>.
 * ---------------------------------------------------------------------------
 */

import type { DomElement, LayoutBox } from './dom-tree';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type PositionScheme = 'static' | 'relative' | 'absolute' | 'fixed' | 'sticky';

export interface LengthOrAuto {
  kind: 'px' | 'percent' | 'auto';
  value: number; // ignored when kind === 'auto'
}

export interface PositionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ---------------------------------------------------------------------------
// Helpers: read position scheme from computed style
// ---------------------------------------------------------------------------

export function getPositionScheme(style: ReadonlyMap<string, string>): PositionScheme {
  const raw = style.get('position');
  if (raw === 'relative' || raw === 'absolute' || raw === 'fixed' || raw === 'sticky') return raw;
  return 'static';
}

export function isPositioned(style: ReadonlyMap<string, string>): boolean {
  return getPositionScheme(style) !== 'static';
}

/**
 * Parse a CSS length value to LengthOrAuto.
 * Handles: 'auto', '10px', '50%', plain numbers.
 */
/** The root element's font size, for `rem` insets; the layout engine sets it with each layout. */
let rootFontSize = 16;
export function setPositioningRootFontSize(px: number): void { rootFontSize = px; }

export function parseLength(
  raw: string | undefined,
  fontSize: number,
  containingSize: number,
): LengthOrAuto {
  if (!raw || raw === 'auto') return { kind: 'auto', value: 0 };
  if (raw.endsWith('px')) {
    const n = parseFloat(raw);
    return { kind: 'px', value: isFinite(n) ? n : 0 };
  }
  if (raw.endsWith('%')) {
    const n = parseFloat(raw);
    return { kind: 'percent', value: isFinite(n) ? n : 0 };
  }
  if (raw.endsWith('vw') || raw.endsWith('vh')) {
    const n = parseFloat(raw);
    return { kind: 'percent', value: isFinite(n) ? n : 0 };
  }
  // rem before em ('1rem' ends with 'em'), and against the root font: both read the element's.
  if (raw.endsWith('rem')) {
    const n = parseFloat(raw);
    return { kind: 'px', value: isFinite(n) ? n * rootFontSize : 0 };
  }
  if (raw.endsWith('em')) {
    const n = parseFloat(raw);
    return { kind: 'px', value: isFinite(n) ? n * fontSize : 0 };
  }
  const n = parseFloat(raw);
  return isFinite(n) ? { kind: 'px', value: n } : { kind: 'auto', value: 0 };
}

/**
 * Resolve the element's computed font-size to a pixel value.
 * The cascade normally resolves `font-size` to px, but be defensive about
 * keywords and relative units. Falls back to the CSS default of 16px.
 */
export function resolveFontSize(style: ReadonlyMap<string, string>): number {
  const raw = style.get('font-size');
  if (!raw) return 16;
  const s = raw.trim();
  if (s.endsWith('px')) {
    const n = parseFloat(s);
    return isFinite(n) ? n : 16;
  }
  if (s.endsWith('em')) {
    const n = parseFloat(s);
    return isFinite(n) ? n * 16 : 16;
  }
  if (s.endsWith('rem')) {
    const n = parseFloat(s);
    return isFinite(n) ? n * 16 : 16;
  }
  const keywordSizes: Record<string, number> = {
    'xx-small': 9, 'x-small': 10, small: 13, medium: 16, large: 18,
    'x-large': 24, 'xx-large': 32, 'xxx-large': 48, smaller: 13, larger: 18,
  };
  if (s in keywordSizes) return keywordSizes[s]!;
  const n = parseFloat(s);
  return isFinite(n) ? n : 16;
}

// ---------------------------------------------------------------------------
// Containing block resolution
// ---------------------------------------------------------------------------

/**
 * Finds the nearest ancestor that acts as the containing block for a box
 * with the given position scheme.
 *
 * Per CSS 2.2 §10.1:
 * - `absolute`: nearest ancestor whose position is NOT static.
 * - `fixed`: nearest ancestor that establishes a containing block for fixed
 *   (currently: any positioned ancestor, same as absolute for now since we
 *   don't model transforms yet). Falls back to root.
 * - `relative`/`sticky`/`static`: use the parent's padding box.
 *
 * Returns the ancestor element, or `null` for the initial containing block
 * (viewport).
 */
/**
 * A transform, filter, perspective, `will-change` of those, or paint/layout containment makes a box
 * the containing block of its fixed (and absolute) descendants (CSS Transforms 1 §2). Fixed boxes
 * always used the viewport, so a fixed overlay inside a transformed modal or slide-in panel landed
 * at the page corner instead of inside it.
 */
export function createsFixedContainingBlock(style: ReadonlyMap<string, string>): boolean {
  const set = (p: string) => { const v = style.get(p)?.trim(); return !!v && v !== 'none'; };
  if (set('transform') || set('perspective') || set('filter') || set('backdrop-filter')) return true;
  if (/transform|perspective|filter/.test(style.get('will-change') ?? '')) return true;
  return /paint|layout|strict|content/.test(style.get('contain') ?? '');
}

export function findContainingBlock(
  node: DomElement,
  scheme: PositionScheme,
): DomElement | null {
  if (scheme === 'fixed' || scheme === 'absolute') {
    let current: DomElement | null = node.parent as DomElement ?? null;
    while (current) {
      const style = current.computedStyle ?? new Map();
      if (createsFixedContainingBlock(style)) return current;
      if (scheme === 'absolute' && getPositionScheme(style) !== 'static') return current;
      current = current.parent as DomElement ?? null;
    }
    return null; // initial containing block (viewport)
  }
  // relative / sticky / static: parent (or null for root)
  return node.parent as DomElement ?? null;
}

// ---------------------------------------------------------------------------
// In-flow offset (relative & sticky's "resting" state)
// ---------------------------------------------------------------------------

function resolveAxisOffset(
  start: LengthOrAuto,
  end: LengthOrAuto,
  containerSize: number,
): number | null {
  const startPx = start.kind === 'auto' ? null
    : start.kind === 'percent' ? (start.value / 100) * containerSize
    : start.value;
  const endPx = end.kind === 'auto' ? null
    : end.kind === 'percent' ? (end.value / 100) * containerSize
    : end.value;

  if (startPx === null && endPx === null) return null;
  if (startPx !== null) return startPx;
  return -(endPx as number);
}

/**
 * `relative`: shift the box from its flow position by resolved offsets.
 * Does NOT affect sibling layout — call only after normal flow is complete.
 */
export function applyInFlowOffset(
  box: LayoutBox,
  style: ReadonlyMap<string, string>,
  fontSize: number,
  containingWidth: number,
  containingHeight: number,
): void {
  const top = parseLength(style.get('top'), fontSize, containingHeight);
  const bottom = parseLength(style.get('bottom'), fontSize, containingHeight);
  const left = parseLength(style.get('left'), fontSize, containingWidth);
  const right = parseLength(style.get('right'), fontSize, containingWidth);

  const dy = resolveAxisOffset(top, bottom, containingHeight) ?? 0;
  const dx = resolveAxisOffset(left, right, containingWidth) ?? 0;

  // Mutate box position — offsets are additive to flow position
  box.x += dx;
  box.y += dy;
}

// ---------------------------------------------------------------------------
// Absolute / fixed placement
// ---------------------------------------------------------------------------

/**
 * Resolve an inset (top/right/bottom/left) for absolute/fixed positioning.
 * auto → 0 for position calculation.
 */
function resolveInset(
  style: ReadonlyMap<string, string>,
  prop: string,
  fontSize: number,
  containingWidth: number,
): { value: number; isAuto: boolean } {
  const raw = style.get(prop);
  if (!raw || raw === 'auto') return { value: 0, isAuto: true };
  const len = parseLength(raw, fontSize, containingWidth);
  if (len.kind === 'auto') return { value: 0, isAuto: true };
  if (len.kind === 'percent') return { value: (len.value / 100) * containingWidth, isAuto: false };
  return { value: len.value, isAuto: false };
}

/**
 * `absolute` / `fixed`: box is out of flow. Position against the padding
 * box of its containing block, using whichever of top/right/bottom/left
 * are set. If both start+end on an axis are set and width/height are auto,
 * the box is stretched.
 *
 * Mutates box.x, box.y, box.width, box.height in place.
 */
export function resolveOutOfFlow(
  box: LayoutBox,
  node: DomElement,
  containingBlock: DomElement | null,
  containingBlockBox: LayoutBox | null,
  viewportWidth: number,
  viewportHeight: number,
  fontSize: number,
): void {
  const style = node.computedStyle ?? new Map();
  const boxSizing = style.get('box-sizing') ?? 'content-box';

  // ── Containing block dimensions (padding box) ──────────────────────
  let cbX: number, cbY: number, cbWidth: number, cbHeight: number;
  if (containingBlockBox) {
    // The padding box: inside the border, padding included (CSS 2.2 §10.1.4). The padding was
    // subtracted too (the content box), so `left: 0; right: 0; bottom: 0` decorations sat inside
    // the padding: httpforever's hero wave landed mid-hero, over the URL pill.
    cbX = containingBlockBox.x + containingBlockBox.borderLeft;
    cbY = containingBlockBox.y + containingBlockBox.borderTop;
    cbWidth = containingBlockBox.width - containingBlockBox.borderLeft - containingBlockBox.borderRight;
    cbHeight = containingBlockBox.height - containingBlockBox.borderTop - containingBlockBox.borderBottom;
  } else {
    cbX = 0; cbY = 0;
    cbWidth = viewportWidth;
    cbHeight = viewportHeight;
  }

  // ── Resolve insets ─────────────────────────────────────────────────
  const top    = resolveInset(style, 'top', fontSize, cbHeight);
  const right  = resolveInset(style, 'right', fontSize, cbWidth);
  const bottom = resolveInset(style, 'bottom', fontSize, cbHeight);
  const left   = resolveInset(style, 'left', fontSize, cbWidth);

  const hasWidth = style.get('width') !== undefined && style.get('width') !== 'auto';
  const hasHeight = style.get('height') !== undefined && style.get('height') !== 'auto';

  // ── Resolve width ──────────────────────────────────────────────────
  if (left.isAuto && right.isAuto && !hasWidth) {
    // Both auto: stays at flow-computed width (already set)
  } else if (!left.isAuto && !right.isAuto && !hasWidth) {
    // Stretch between left and right (box.width is the border box)
    box.width = Math.max(0, cbWidth - left.value - right.value - box.marginLeft - box.marginRight);
  } else if (!left.isAuto) {
    // left is set; width may be set or auto
    // position is determined by left, width stays as-is
  } else if (!right.isAuto) {
    // right is set, left is auto — shift x
    box.x = cbX + cbWidth - right.value - box.width - box.marginRight;
  }

  // ── Resolve height ─────────────────────────────────────────────────
  if (top.isAuto && bottom.isAuto && !hasHeight) {
    // Both auto: stays at flow-computed height (already set)
  } else if (!top.isAuto && !bottom.isAuto && !hasHeight) {
    box.height = Math.max(0, cbHeight - top.value - bottom.value - box.marginTop - box.marginBottom);
  } else if (!top.isAuto) {
    // top is set
  } else if (!bottom.isAuto) {
    // bottom is set, top is auto — shift y
    box.y = cbY + cbHeight - bottom.value - box.height - box.marginBottom;
  }

  // ── Final position ─────────────────────────────────────────────────
  if (!left.isAuto) {
    box.x = cbX + left.value + box.marginLeft;
  }
  if (!top.isAuto) {
    box.y = cbY + top.value + box.marginTop;
  }

  // With both insets and the width set, auto margins share what is left (CSS 2.2 §10.3.7):
  // `left: 0; right: 0; width: 300px; margin: auto` centres a dialog. They were 0: it sat left.
  const mlAuto = style.get('margin-left') === 'auto';
  const mrAuto = style.get('margin-right') === 'auto';
  if (!left.isAuto && !right.isAuto && hasWidth && (mlAuto || mrAuto)) {
    const free = cbWidth - left.value - right.value - box.width - (mlAuto ? 0 : box.marginLeft) - (mrAuto ? 0 : box.marginRight);
    box.x = cbX + left.value + (mlAuto && mrAuto ? Math.max(0, free / 2) : mlAuto ? free : box.marginLeft);
  }

  // ── Auto margins for centering when width/height are not specified ─
  if (!hasWidth) {
    const autoLeft = left.isAuto;
    const autoRight = right.isAuto;
    if (autoLeft && autoRight) {
      const marginSpace = box.width + box.marginLeft + box.marginRight
        + box.borderLeft + box.borderRight + box.paddingLeft + box.paddingRight;
      const remaining = cbWidth - marginSpace;
      const halfMargin = Math.max(0, remaining / 2);
      box.x = cbX + halfMargin + box.marginLeft;
    }
  }

  if (!hasHeight) {
    const autoTop = top.isAuto;
    const autoBottom = bottom.isAuto;
    if (autoTop && autoBottom) {
      const marginSpace = box.height + box.marginTop + box.marginBottom
        + box.borderTop + box.borderBottom + box.paddingTop + box.paddingBottom;
      const remaining = cbHeight - marginSpace;
      const halfMargin = Math.max(0, remaining / 2);
      box.y = cbY + halfMargin + box.marginTop;
    }
  }
}

// ---------------------------------------------------------------------------
// Sticky positioning
// ---------------------------------------------------------------------------

export interface StickyConstraint {
  node: DomElement;
  box: LayoutBox;
  scrollContainer: DomElement;
  flowRectInScrollContainer: PositionRect;
}

/**
 * Sticky positioning is recomputed on every scroll event of its nearest
 * scrolling ancestor. It behaves like `relative` (offset applied to its own
 * flow position) UNTIL the scroll would carry it past the threshold implied
 * by top/right/bottom/left, at which point it clamps to that edge of the
 * scroll container's viewport, but never past its own flow-box's box
 * (it can't leave the bounds of its containing/flow parent).
 */
export class StickyController {
  private constraints: StickyConstraint[] = [];

  register(constraint: StickyConstraint): void {
    this.constraints.push(constraint);
  }

  clear(): void {
    this.constraints = [];
  }

  /** Call this on scroll of any registered scroll container. */
  recompute(scrollContainer: DomElement, scrollTop: number, scrollLeft: number): void {
    for (const c of this.constraints) {
      if (c.scrollContainer !== scrollContainer) continue;
      this.recomputeOne(c, scrollTop, scrollLeft);
    }
  }

  private recomputeOne(c: StickyConstraint, scrollTop: number, scrollLeft: number): void {
    const { box, node } = c;
    const style = node.computedStyle ?? new Map();
    const scBox = c.scrollContainer.layoutBox;
    if (!scBox) return;

    const viewportHeight = scBox.height - scBox.borderTop - scBox.borderBottom
      - scBox.paddingTop - scBox.paddingBottom;
    const viewportWidth = scBox.width - scBox.borderLeft - scBox.borderRight
      - scBox.paddingLeft - scBox.paddingRight;

    const visibleTop = scrollTop;
    const visibleLeft = scrollLeft;
    const visibleBottom = scrollTop + viewportHeight;
    const visibleRight = scrollLeft + viewportWidth;

    const fontSize = resolveFontSize(style);
    let y = c.flowRectInScrollContainer.y;
    let x = c.flowRectInScrollContainer.x;

    const top = parseLength(style.get('top'), fontSize, viewportHeight);
    const bottom = parseLength(style.get('bottom'), fontSize, viewportHeight);
    const left = parseLength(style.get('left'), fontSize, viewportWidth);
    const right = parseLength(style.get('right'), fontSize, viewportWidth);

    if (top.kind !== 'auto') {
      const topPx = top.kind === 'percent' ? (top.value / 100) * viewportHeight : top.value;
      const stuckY = visibleTop + topPx;
      y = Math.max(c.flowRectInScrollContainer.y, stuckY);
    } else if (bottom.kind !== 'auto') {
      const bottomPx = bottom.kind === 'percent' ? (bottom.value / 100) * viewportHeight : bottom.value;
      const stuckY = visibleBottom - bottomPx - c.flowRectInScrollContainer.height;
      y = Math.min(c.flowRectInScrollContainer.y, stuckY);
    }

    if (left.kind !== 'auto') {
      const leftPx = left.kind === 'percent' ? (left.value / 100) * viewportWidth : left.value;
      const stuckX = visibleLeft + leftPx;
      x = Math.max(c.flowRectInScrollContainer.x, stuckX);
    } else if (right.kind !== 'auto') {
      const rightPx = right.kind === 'percent' ? (right.value / 100) * viewportWidth : right.value;
      const stuckX = visibleRight - rightPx - c.flowRectInScrollContainer.width;
      x = Math.min(c.flowRectInScrollContainer.x, stuckX);
    }

    box.x = x;
    box.y = y;
  }
}

// ---------------------------------------------------------------------------
// Z-index / stacking context helpers
// ---------------------------------------------------------------------------

/**
 * Get the resolved z-index from computed style.
 * Returns a number; 'auto' is treated as 0 for non-positioned elements.
 */
export function getZIndex(
  style: ReadonlyMap<string, string>,
  position: PositionScheme,
): number {
  const raw = style.get('z-index');
  if (!raw || raw === 'auto') {
    // auto z-index for positioned elements creates a stacking context
    // at z=0; non-positioned at z=0.
    return position === 'static' ? 0 : 0;
  }
  const n = parseInt(raw, 10);
  return isFinite(n) ? n : 0;
}

/**
 * Compute the layer index used for paint ordering.
 * Non-positioned elements go at z=0; positioned elements at z=1000+zIndex.
 * Negative CSS z-index for positioned elements stays negative.
 */
export function getStackingLevel(
  style: ReadonlyMap<string, string>,
  position: PositionScheme,
): number {
  if (position === 'static') return 0;
  const z = getZIndex(style, position);
  return 1000 + z;
}
