import type { DomElement, DomNode, LayoutBox } from '../dom-tree';
import type { ClassifiedChild } from './types';
import { classifyDisplay } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// BLOCK FORMATTING CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Describes a block-level box produced by the block formatting context.
 * Used internally during layout to track margin collapsing.
 */
export interface BlockLevelBox {
  /** The DOM element (null for anonymous blocks). */
  element: DomElement | null;
  /** Border-box position X. */
  x: number;
  /** Border-box position Y. */
  y: number;
  /** Border-box width. */
  width: number;
  /** Border-box height (0 until finalized). */
  height: number;
  marginTop: number;
  marginBottom: number;
  marginLeft: number;
  marginRight: number;
  paddingTop: number;
  paddingBottom: number;
  borderTop: number;
  borderBottom: number;
  paddingLeft: number;
  paddingRight: number;
  borderLeft: number;
  borderRight: number;
  /** The collapse-top margin (may be resolved via collapsing). */
  collapsedMarginTop: number;
  /** The collapse-bottom margin (may be resolved via collapsing). */
  collapsedMarginBottom: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// ANONYMOUS BOX GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifies and groups children of a block container.
 *
 * Per CSS 2.2 §9.2.1.1, when a block container has both block-level and
 * inline-level children, the inline content is wrapped in anonymous blocks.
 *
 * Returns an ordered list of groups, where each group is either:
 *  - A contiguous run of block-level children
 *  - An anonymous block wrapping a contiguous run of inline-level children
 */
export function classifyChildren(
  children: readonly DomNode[],
): ClassifiedChild[][] {
  const groups: ClassifiedChild[][] = [];
  let currentGroup: ClassifiedChild[] = [];
  let currentIsBlock: boolean | null = null;

  for (const child of children) {
    if (child.nodeType === 'text') {
      // Text nodes are inline-level
      const classified: ClassifiedChild = {
        node: child,
        display: 'inline',
        isBlock: false,
      };
      if (currentIsBlock === true) {
        // Transition from block to inline — start new group
        if (currentGroup.length > 0) groups.push(currentGroup);
        currentGroup = [classified];
        currentIsBlock = false;
      } else {
        currentGroup.push(classified);
        currentIsBlock = false;
      }
      continue;
    }

    if (child.nodeType !== 'element') continue;

    const el = child as DomElement;
    const style = el.computedStyle ?? new Map();
    const display = style.get('display') ?? 'inline';
    const classified: ClassifiedChild = {
      node: el,
      display,
      isBlock: classifyDisplay(display) === 'block',
    };

    if (classified.isBlock) {
      if (currentIsBlock === false) {
        // Transition from inline to block — wrap inline run as anonymous block
        if (currentGroup.length > 0) groups.push(currentGroup);
        currentGroup = [classified];
        currentIsBlock = true;
      } else {
        currentGroup.push(classified);
        currentIsBlock = true;
      }
    } else {
      if (currentIsBlock === true) {
        // Transition from block to inline — start new group
        if (currentGroup.length > 0) groups.push(currentGroup);
        currentGroup = [classified];
        currentIsBlock = false;
      } else {
        currentGroup.push(classified);
        currentIsBlock = false;
      }
    }
  }

  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups;
}

// ─────────────────────────────────────────────────────────────────────────────
// MARGIN COLLAPSING
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Collapses two adjoining vertical margins.
 *
 * CSS 2.2 §8.3.1: When two adjoining margins are both positive, the larger
 * one wins. When one is negative, the absolute value is subtracted from the
 * other. When both are negative, the smaller (more negative) one wins.
 */
export function collapseMargins(m1: number, m2: number): number {
  if (m1 >= 0 && m2 >= 0) return Math.max(m1, m2);
  if (m1 <= 0 && m2 <= 0) return Math.min(m1, m2);
  return m1 + m2;
}

/**
 * Determines whether margin collapsing is blocked between a parent and its
 * first/last child.
 *
 * CSS 2.2 §8.3.1: Parent's top/bottom padding or border blocks collapsing
 * with the first/last child's margin.
 */
export function isMarginCollapseBlocked(
  parentBorderTop: number,
  parentBorderBottom: number,
  parentPaddingTop: number,
  parentPaddingBottom: number,
  side: 'top' | 'bottom',
): boolean {
  if (side === 'top') {
    return parentBorderTop > 0 || parentPaddingTop > 0;
  }
  return parentBorderBottom > 0 || parentPaddingBottom > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT HELPERS
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Extracts a resolved box model from a DOM element's computed style.
 */
export function resolveBoxModel(
  style: ReadonlyMap<string, string>,
  resolveLength: (value: string, fontSize: number, containingWidth: number) => number,
  parseBorderWidth: (value: string) => number,
  fontSize: number,
  availableWidth: number,
): {
  margins: { top: number; right: number; bottom: number; left: number };
  padding: { top: number; right: number; bottom: number; left: number };
  borders: { top: number; right: number; bottom: number; left: number };
  borderWidthBox: number;
  contentWidth: number;
  boxSizing: string;
} {
  const resolve = (prop: string, fallback: string): number =>
    resolveLength(style.get(prop) ?? fallback, fontSize, availableWidth);

  const marginLeft   = resolve('margin-left',   style.get('margin') ?? '0');
  const marginRight  = resolve('margin-right',  style.get('margin') ?? '0');
  const marginTop    = resolve('margin-top',    style.get('margin') ?? '0');
  const marginBottom = resolve('margin-bottom', style.get('margin') ?? '0');

  const paddingTop    = resolve('padding-top',    style.get('padding') ?? '0');
  const paddingRight  = resolve('padding-right',  style.get('padding') ?? '0');
  const paddingBottom = resolve('padding-bottom', style.get('padding') ?? '0');
  const paddingLeft   = resolve('padding-left',   style.get('padding') ?? '0');

  const borderTop    = parseBorderWidth(style.get('border-top-width') ?? '0');
  const borderRight  = parseBorderWidth(style.get('border-right-width') ?? '0');
  const borderBottom = parseBorderWidth(style.get('border-bottom-width') ?? '0');
  const borderLeft   = parseBorderWidth(style.get('border-left-width') ?? '0');

  const boxSizing = style.get('box-sizing') ?? 'content-box';
  const specWidth = style.get('width');

  let borderWidthBox: number;
  if (specWidth && specWidth !== 'auto') {
    const specified = resolveLength(style.get('width') ?? '0', fontSize, availableWidth);
    if (boxSizing === 'border-box') {
      borderWidthBox = Math.min(specified, availableWidth);
    } else {
      borderWidthBox = specified + paddingLeft + paddingRight + borderLeft + borderRight;
      borderWidthBox = Math.min(borderWidthBox, availableWidth);
    }
  } else {
    borderWidthBox = availableWidth;
  }

  const contentWidth = borderWidthBox - paddingLeft - paddingRight - borderLeft - borderRight;

  return {
    margins: { top: marginTop, right: marginRight, bottom: marginBottom, left: marginLeft },
    padding: { top: paddingTop, right: paddingRight, bottom: paddingBottom, left: paddingLeft },
    borders: { top: borderTop, right: borderRight, bottom: borderBottom, left: borderLeft },
    borderWidthBox,
    contentWidth,
    boxSizing,
  };
}
