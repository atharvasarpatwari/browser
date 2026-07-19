import type { DomElement, DomNode } from '../dom-tree';
import { classifyDisplay } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// STACKING CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Per CSS 2.2 Appendix E, a stacking context is formed by an element that:
 * - Is the root element
 * - Has position != static AND z-index != auto
 * - Has opacity < 1 (CSS3)
 * - Has transform != none (CSS3)
 * - Has filter != none (CSS3)
 * - Has isolation: isolate
 *
 * Within each stacking context, painting proceeds in 7 sub-layers:
 *   0. Background/borders of the element forming the context
 *   1. Child stacking contexts with negative z-index (sorted asc)
 *   2. In-flow non-inline-level non-positioned descendants (blocks)
 *   3. Non-positioned floating descendants (floats)
 *   4. In-flow inline-level non-positioned descendants (inlines)
 *   5. Positioned descendants with z-index auto or 0, plus child contexts with z-index 0
 *   6. Child stacking contexts with positive z-index (sorted asc)
 *
 * Within the same z-index, elements are painted in DOM order (stable sort).
 */
export interface StackingContext {
  /** The element that establishes this context. */
  readonly element: DomElement;
  /** Resolved z-index within the parent context. */
  readonly zIndex: number;
  /** Child stacking contexts, sorted by (zIndex, DOM order). */
  readonly children: StackingContext[];
  /** Level 0: this element's own background/border commands (collected by paint engine). */
  bgCommands: PaintCmd[];
  /** Level 2: block non-positioned in-flow descendants. */
  readonly blockEntries: DomElement[];
  /** Level 3: float non-positioned descendants. */
  readonly floatEntries: DomElement[];
  /** Level 4: inline non-positioned in-flow descendants. */
  readonly inlineEntries: DomElement[];
  /** Level 5: positioned descendants with z-index auto or 0. */
  readonly positionedAutoEntries: DomElement[];
  /** Whether this context has opacity < 1 (needs group compositing). */
  readonly isGrouped: boolean;
  /** The resolved opacity for group compositing. */
  readonly groupOpacity: number;
}

/** Paint command placeholder — mirrors PaintCommand from paint-engine. */
export interface PaintCmd {
  readonly type: string;
  readonly params: readonly unknown[];
}

// ─────────────────────────────────────────────────────────────────────────────
// STYLING HELPERS
// ─────────────────────────────────────────────────────────────────────────────

function getStyle(el: DomElement): ReadonlyMap<string, string> {
  return el.computedStyle ?? new Map();
}

function getPosition(style: ReadonlyMap<string, string>): string {
  return style.get('position') ?? 'static';
}

function getZIndexRaw(style: ReadonlyMap<string, string>): string | undefined {
  return style.get('z-index');
}

function getOpacity(style: ReadonlyMap<string, string>): number {
  return parseFloat(style.get('opacity') ?? '1') || 1;
}

function getTransform(style: ReadonlyMap<string, string>): string | undefined {
  return style.get('transform');
}

function getFilter(style: ReadonlyMap<string, string>): string | undefined {
  return style.get('filter');
}

function getIsolation(style: ReadonlyMap<string, string>): string | undefined {
  return style.get('isolation');
}

function getDisplay(style: ReadonlyMap<string, string>): string {
  return style.get('display') ?? 'inline';
}

function isPositionedElement(style: ReadonlyMap<string, string>): boolean {
  const pos = getPosition(style);
  return pos === 'relative' || pos === 'absolute' || pos === 'fixed' || pos === 'sticky';
}

function parseZIndex(raw: string | undefined): number {
  if (!raw || raw === 'auto') return 0;
  const n = parseInt(raw, 10);
  return isFinite(n) ? n : 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// STACKING CONTEXT CREATION RULES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Determine whether an element creates a new stacking context.
 *
 * Per CSS 2.2 Appendix E and CSS3 additions:
 * 1. Root element
 * 2. Positioned element with z-index != auto
 * 3. opacity < 1
 * 4. transform != none
 * 5. filter != none
 * 6. isolation: isolate
 */
export function createsStackingContext(
  el: DomElement,
  isRoot: boolean,
): boolean {
  if (isRoot) return true;

  const style = getStyle(el);

  // Positioned with explicit z-index
  if (isPositionedElement(style)) {
    const zRaw = getZIndexRaw(style);
    if (zRaw !== undefined && zRaw !== 'auto') return true;
  }

  // opacity < 1
  if (getOpacity(style) < 1) return true;

  // transform != none
  const transform = getTransform(style);
  if (transform && transform !== 'none') return true;

  // filter != none
  const filter = getFilter(style);
  if (filter && filter !== 'none') return true;

  // isolation: isolate
  if (getIsolation(style) === 'isolate') return true;

  return false;
}

// ─────────────────────────────────────────────────────────────────────────────
// BUILD STACKING CONTEXT TREE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Build the stacking context tree from the DOM tree.
 *
 * Walks the DOM tree depth-first. When an element creates a stacking context,
 * it becomes the root of a new StackingContext and its children are classified
 * within it. When it does not, its children are classified within the nearest
 * ancestor stacking context.
 *
 * @param root - The root element (typically <html>)
 * @returns The root StackingContext
 */
export function buildStackingContextTree(root: DomElement): StackingContext {
  const tree = createContext(root, true);
  return tree;
}

function createContext(el: DomElement, isRoot: boolean): StackingContext {
  const style = getStyle(el);
  const opacity = getOpacity(style);

  const ctx: StackingContext = {
    element: el,
    zIndex: 0,
    children: [],
    bgCommands: [],
    blockEntries: [],
    floatEntries: [],
    inlineEntries: [],
    positionedAutoEntries: [],
    isGrouped: opacity < 1,
    groupOpacity: opacity,
  };

  classifyChildrenIntoContext(ctx, el, isRoot);
  sortChildContexts(ctx);

  return ctx;
}

/**
 * Walk through the element's children and classify each one:
 * - If a child creates a stacking context → recurse into a new StackingContext
 *   and add it to ctx.children
 * - If a child does NOT create a stacking context → classify it into one of the
 *   parent context's sub-layers
 */
function classifyChildrenIntoContext(
  ctx: StackingContext,
  el: DomElement,
  _isRootCtx: boolean,
): void {
  for (const child of el.children) {
    if (!child || child.nodeType !== 'element') continue;
    const childEl = child as DomElement;
    const childStyle = getStyle(childEl);
    const display = getDisplay(childStyle);
    if (display === 'none') continue;

    if (createsStackingContext(childEl, false)) {
      // Child creates its own stacking context
      const childCtx = createContext(childEl, false);
      const position = getPosition(childStyle);
      if (isPositionedElement(childStyle)) {
        childCtx.zIndex = parseZIndex(getZIndexRaw(childStyle));
      } else {
        childCtx.zIndex = 0;
      }
      ctx.children.push(childCtx);
    } else {
      // Child participates in parent context — classify into sub-layer
      classifyElementIntoLayer(ctx, childEl);
      // Also recurse into this child's descendants
      classifyChildrenIntoContext(ctx, childEl, false);
    }
  }
}

/**
 * Classify a non-context-forming element into the appropriate sub-layer
 * of its parent stacking context.
 *
 * Per CSS 2.2 Appendix E:
 * - Level 2: block non-positioned in-flow
 * - Level 3: float non-positioned
 * - Level 4: inline non-positioned in-flow
 * - Level 5: positioned with z-index auto or 0
 */
function classifyElementIntoLayer(
  ctx: StackingContext,
  el: DomElement,
): void {
  const style = getStyle(el);
  const display = getDisplay(style);
  const positioned = isPositionedElement(style);
  const classified = classifyDisplay(display);

  if (positioned) {
    // Positioned elements: level 5 (z-index auto or 0, since we already
    // filtered out those that create stacking contexts above)
    ctx.positionedAutoEntries.push(el);
    return;
  }

  // Non-positioned elements
  const isFloat = style.get('float') !== 'none' && style.get('float') !== undefined;

  if (isFloat) {
    // Level 3: floats
    ctx.floatEntries.push(el);
  } else if (classified === 'block') {
    // Level 2: blocks
    ctx.blockEntries.push(el);
  } else {
    // Level 4: inlines and everything else
    ctx.inlineEntries.push(el);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SORTING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sort child stacking contexts by (zIndex ascending, then DOM order).
 *
 * DOM order is determined by the element's position in the children array
 * of the parent element, which is the order they appear in the source.
 * Since we iterate children in order, the array already has DOM order.
 * We use a stable sort to preserve it within same z-index.
 */
function sortChildContexts(ctx: StackingContext): void {
  // Stable sort by zIndex (ascending)
  ctx.children.sort((a, b) => a.zIndex - b.zIndex);
}

// ─────────────────────────────────────────────────────────────────────────────
// RENDERING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Render a stacking context and its descendants into a flat list of paint
 * commands, in the correct paint order per CSS 2.2 Appendix E.
 *
 * @param ctx - The stacking context to render
 * @param paintElement - Callback to paint a single element and return its commands
 * @returns Flat array of paint commands
 */
export function renderStackingContext(
  ctx: StackingContext,
  paintElement: (el: DomElement) => PaintCmd[],
): PaintCmd[] {
  const commands: PaintCmd[] = [];

  // Wrap in group opacity if needed
  if (ctx.isGrouped) {
    commands.push({ type: 'save', params: [] });
    commands.push({ type: 'setGlobalAlpha', params: [ctx.groupOpacity] });
  }

  // ── Layer 0: Background/borders of the context-forming element ─────
  // (bgCommands are populated externally by the paint engine)
  commands.push(...ctx.bgCommands);

  // ── Layer 1: Child contexts with negative z-index ──────────────────
  for (const child of ctx.children) {
    if (child.zIndex < 0) {
      commands.push(...renderStackingContext(child, paintElement));
    }
  }

  // ── Layer 2: Block non-positioned in-flow descendants ──────────────
  for (const el of ctx.blockEntries) {
    commands.push(...paintElement(el));
  }

  // ── Layer 3: Float non-positioned descendants ──────────────────────
  for (const el of ctx.floatEntries) {
    commands.push(...paintElement(el));
  }

  // ── Layer 4: Inline non-positioned in-flow descendants ─────────────
  for (const el of ctx.inlineEntries) {
    commands.push(...paintElement(el));
  }

  // ── Layer 5: Positioned descendants with z-index auto or 0, plus
  //     child stacking contexts with z-index exactly 0 ──────────────────
  for (const el of ctx.positionedAutoEntries) {
    commands.push(...paintElement(el));
  }
  for (const child of ctx.children) {
    if (child.zIndex === 0) {
      commands.push(...renderStackingContext(child, paintElement));
    }
  }

  // ── Layer 6: Child contexts with positive z-index ──────────────────
  for (const child of ctx.children) {
    if (child.zIndex > 0) {
      commands.push(...renderStackingContext(child, paintElement));
    }
  }

  // Close group opacity
  if (ctx.isGrouped) {
    commands.push({ type: 'restore', params: [] });
  }

  return commands;
}
