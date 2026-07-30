import type { IDisposable } from '../../app/dependency-container';
import type { IDomTree, DomDocument, DomElement, DomNode, LayoutBox, TextRun } from './dom-tree';
import { DamageTracker } from './damage-tracker';
import { findContainingBlock as findContainingBlockForScheme, resolveOutOfFlow, applyInFlowOffset } from './positioning';
import { classifyDisplay, isBlockLevel } from './formatting/types';
import { classifyChildren, collapseMargins, isMarginCollapseBlocked } from './formatting/block-context';
import { InlineFormattingContext } from './formatting/inline-context';
import { FloatContext } from './formatting/float-context';
import {
  FlexFormattingContext,
  isRowDirection,
  computeJustifyOffset,
  computeJustifyGap,
} from './formatting/flex-context';
import type { FlexDirection, FlexWrap, JustifyContent, AlignItems, AlignContent, AlignSelf, FlexItem } from './formatting/flex-context';
import {
  GridFormattingContext,
  parseTrackList,
  parseGridPlacement,
  parseGridTemplateAreas,
  findAreaPlacement,
} from './formatting/grid-context';
import type { GridItem, GridPlacement, GridAxisAlign, GridSelfAlign } from './formatting/grid-context';
import type { LineBox } from './formatting/types';
import {
  TableFormattingContext,
  generateAnonymousTableBoxes,
  classifyTableChild,
} from './formatting/table-context';
import {
  MultiColumnFormattingContext,
} from './formatting/multi-column-context';

interface LayoutConfig {
  readonly viewportWidth: number;
  readonly viewportHeight: number;
  readonly defaultFontSize: number;
}

const DEFAULT_LAYOUT_CONFIG: LayoutConfig = {
  viewportWidth: 1920,
  viewportHeight: 1080,
  defaultFontSize: 16,
};

interface ILayoutEngine extends IDisposable {
  layout(document: DomDocument, domTree?: IDomTree, config?: Partial<LayoutConfig>): void;
  getLayoutBox(domId: string): LayoutBox | null;
  getElementAtPoint(x: number, y: number): DomElement | null;
  getConfig(): LayoutConfig;
  updateConfig(config: Partial<LayoutConfig>): void;
}

// ─────────────────────────────────────────────────────────────────────────────
// NAMED FONT SIZE RESOLUTION
// ─────────────────────────────────────────────────────────────────────────────

const NAMED_FONT_SIZES: Record<string, number> = {
  'xx-small': 9,
  'x-small': 10,
  'small': 13,
  'medium': 16,
  'large': 18,
  'x-large': 24,
  'xx-large': 32,
  'smaller': 13,
  'larger': 18,
};

// ─────────────────────────────────────────────────────────────────────────────
// LAYOUT ENGINE
// ─────────────────────────────────────────────────────────────────────────────

class LayoutEngine implements ILayoutEngine {
  private config: LayoutConfig;
  private readonly layoutBoxes = new Map<string, LayoutBox>();
  private readonly elementPositions: Array<{ element: DomElement; box: LayoutBox }> = [];
  private rootFontSize = DEFAULT_LAYOUT_CONFIG.defaultFontSize;

  /** Queue of absolute/fixed elements to lay out after normal flow. */
  private positionedQueue: Array<{
    element: DomElement;
    containingBlock: DomElement | null;
    fontSize: number;
    availableWidth: number;
    domTree?: IDomTree;
  }> = [];

  /** Current float context for the active block formatting context. */
  private floatContext: FloatContext | null = null;

  /** Multi-column contexts keyed by domId. */
  private multiColumnContexts = new Map<string, MultiColumnFormattingContext>();

  /** Scrollable containers keyed by domId. */
  private scrollContainers = new Map<string, import('./compositing/scroll-compositor').ScrollableContainer>();

  constructor(config?: Partial<LayoutConfig>) {
    this.config = { ...DEFAULT_LAYOUT_CONFIG, ...config };
    this.rootFontSize = this.config.defaultFontSize;
  }

  layout(document: DomDocument, domTree?: IDomTree, config?: Partial<LayoutConfig>): void {
    if (config) this.config = { ...this.config, ...config };
    this.rootFontSize = this.config.defaultFontSize;
    this.layoutBoxes.clear();
    this.elementPositions.length = 0;
    this.positionedQueue.length = 0;
    this.multiColumnContexts.clear();
    this.scrollContainers.clear();

    if (document.bodyElement) {
      this.layoutNode(document.bodyElement, 0, 0, this.config.viewportWidth, this.config.defaultFontSize, domTree);
    } else {
      let y = 0;
      for (const child of document.children) {
        if (child.nodeType === 'element') {
          y = this.layoutNode(child as DomElement, 0, y, this.config.viewportWidth, this.config.defaultFontSize, domTree);
        }
      }
    }

    // ── Second pass: lay out positioned elements ──────────────────────────
    this.layoutPositionedElements();
    this.floatContext = null;
  }

  /**
   * Incremental layout: only re-lay-out elements marked dirty in the DOM tree.
   * Returns the damage tracker containing bounding boxes of all re-laid-out elements.
   */
  layoutIncremental(document: DomDocument, domTree: IDomTree, config?: Partial<LayoutConfig>): DamageTracker {
    if (config) this.config = { ...this.config, ...config };
    this.rootFontSize = this.config.defaultFontSize;
    const damage = new DamageTracker();

    domTree.processMutations();

    if (document.bodyElement) {
      this.layoutNodeIncremental(document.bodyElement, 0, 0, this.config.viewportWidth, this.config.defaultFontSize, domTree, damage);
    } else {
      let y = 0;
      for (const child of document.children) {
        if (child.nodeType === 'element') {
          y = this.layoutNodeIncremental(child as DomElement, 0, y, this.config.viewportWidth, this.config.defaultFontSize, domTree, damage);
        }
      }
    }

    this.layoutPositionedElements();

    if (!damage.isEmpty()) damage.compact();
    return damage;
  }

  getLayoutBox(domId: string): LayoutBox | null {
    return this.layoutBoxes.get(domId) ?? null;
  }

  getElementAtPoint(x: number, y: number): DomElement | null {
    for (let i = this.elementPositions.length - 1; i >= 0; i--) {
      const { element, box } = this.elementPositions[i]!;
      if (
        x >= box.x && x <= box.x + box.width &&
        y >= box.y && y <= box.y + box.height
      ) {
        return element;
      }
    }
    return null;
  }

  getConfig(): LayoutConfig {
    return { ...this.config };
  }

  updateConfig(config: Partial<LayoutConfig>): void {
    this.config = { ...this.config, ...config };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CORE LAYOUT
  // ─────────────────────────────────────────────────────────────────────────

  /** Recursively layout a single DOM element and its children. Returns the total height consumed. */
  private layoutNode(
    node: DomElement,
    x: number,
    y: number,
    availableWidth: number,
    parentFontSize: number,
    domTree?: IDomTree,
  ): number {
    const style = node.computedStyle ?? new Map();
    const display = style.get('display') ?? 'inline';
    const position = style.get('position') ?? 'static';

    if (display === 'none') return y;

    // ── Absolute/Fixed: removed from flow, laid out in second pass ──────
    if (position === 'absolute' || position === 'fixed') {
      // Still need a zero-size box so getElementAtPoint doesn't crash
      const box: LayoutBox = {
        x: 0, y: 0, width: 0, height: 0,
        marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
        paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
        borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
      };
      this.layoutBoxes.set(node.domId, box);
      this.elementPositions.push({ element: node, box });
      // Queue for positioned layout after normal flow
      const containingBlock = position === 'fixed'
        ? null // viewport
        : findContainingBlockForScheme(node, position as 'absolute' | 'fixed' | 'sticky');
      const fontSize = this.resolveFontSize(style, parentFontSize);
      this.positionedQueue.push({ element: node, containingBlock, fontSize, availableWidth, domTree });
      return y; // doesn't take space in flow
    }

    const fmtType = classifyDisplay(display);
    const isBlock = fmtType === 'block';

    // ── Resolve font-size for this element ────────────────────────────────
    const fontSize = this.resolveFontSize(style, parentFontSize);

    // ── Resolve all box model lengths ─────────────────────────────────────
    const resolve = (prop: string, fallback: string): number =>
      this.resolveLength(style.get(prop) ?? fallback, fontSize, availableWidth);

    const marginLeft   = resolve('margin-left',   style.get('margin') ?? '0');
    const marginRight  = resolve('margin-right',  style.get('margin') ?? '0');
    const marginTop    = resolve('margin-top',    style.get('margin') ?? '0');
    const marginBottom = resolve('margin-bottom', style.get('margin') ?? '0');

    const paddingTop    = resolve('padding-top',    style.get('padding') ?? '0');
    const paddingRight  = resolve('padding-right',  style.get('padding') ?? '0');
    const paddingBottom = resolve('padding-bottom', style.get('padding') ?? '0');
    const paddingLeft   = resolve('padding-left',   style.get('padding') ?? '0');

    const borderTop    = this.resolveBorder(style, 'top');
    const borderRight  = this.resolveBorder(style, 'right');
    const borderBottom = this.resolveBorder(style, 'bottom');
    const borderLeft   = this.resolveBorder(style, 'left');

    // ── Resolve width ─────────────────────────────────────────────────────
    const boxSizing = style.get('box-sizing') ?? 'content-box';
    const specWidth = style.get('width');
    const specHeight = style.get('height');

    // Parse aspect-ratio
    const rawAspectRatio = style.get('aspect-ratio') ?? 'auto';
    let aspectRatio: number | null = null;
    if (rawAspectRatio !== 'auto') {
      const parts = rawAspectRatio.split('/');
      if (parts.length === 2) {
        const w = parseFloat(parts[0]);
        const h = parseFloat(parts[1]);
        if (w > 0 && h > 0) aspectRatio = w / h;
      } else {
        const n = parseFloat(rawAspectRatio);
        if (n > 0) aspectRatio = n;
      }
    }

    let borderWidthBox: number;
    if (specWidth && specWidth !== 'auto') {
      const specified = resolve('width', '0');
      if (boxSizing === 'border-box') {
        borderWidthBox = Math.min(specified, availableWidth);
      } else {
        borderWidthBox = specified + paddingLeft + paddingRight + borderLeft + borderRight;
        borderWidthBox = Math.min(borderWidthBox, availableWidth);
      }
    } else if (aspectRatio != null && specHeight && specHeight !== 'auto') {
      // Compute width from height × aspect-ratio
      const hContent = resolve('height', '0') - paddingTop - paddingBottom - borderTop - borderBottom;
      const wContent = hContent * aspectRatio;
      if (boxSizing === 'border-box') {
        borderWidthBox = Math.min(wContent + paddingLeft + paddingRight + borderLeft + borderRight, availableWidth);
      } else {
        borderWidthBox = Math.min(wContent + paddingLeft + paddingRight + borderLeft + borderRight, availableWidth);
      }
    } else {
      borderWidthBox = availableWidth;
    }

    // ── Resolve height ────────────────────────────────────────────────────
    let specifiedContentHeight: number;
    if (specHeight && specHeight !== 'auto') {
      if (boxSizing === 'border-box') {
        specifiedContentHeight = resolve('height', '0') - paddingTop - paddingBottom - borderTop - borderBottom;
      } else {
        specifiedContentHeight = resolve('height', '0');
      }
    } else if (aspectRatio != null && specWidth && specWidth !== 'auto') {
      // Compute height from width / aspect-ratio
      const wContent = borderWidthBox - paddingLeft - paddingRight - borderLeft - borderRight;
      specifiedContentHeight = wContent / aspectRatio;
    } else {
      specifiedContentHeight = 0;
    }

    // ── Position the border box ───────────────────────────────────────────
    const posX = x + marginLeft;
    const posY = y + marginTop;

    // ── Content area dimensions (box-sizing aware) ────────────────────────
    const contentWidth  = Math.max(0, borderWidthBox - paddingLeft - paddingRight - borderLeft - borderRight);

    // ── Register element BEFORE children so it appears at a lower index.
    // getElementAtPoint iterates from the end (deepest/last-rendered first),
    // so children (pushed later by recursion) are checked before parents.
    const box: LayoutBox = {
      x: posX,
      y: posY,
      width: borderWidthBox,
      height: 0, // updated after children
      marginTop, marginRight, marginBottom, marginLeft,
      paddingTop, paddingRight, paddingBottom, paddingLeft,
      borderTop, borderRight, borderBottom, borderLeft,
    };
    this.layoutBoxes.set(node.domId, box);
    this.elementPositions.push({ element: node, box });

    // ── Apply relative offset (does NOT affect sibling layout) ────────────
    if (position === 'relative') {
      const cbWidth = availableWidth;
      const cbHeight = availableWidth; // approximate
      applyInFlowOffset(box, style, fontSize, cbWidth, cbHeight);
    }

    // ── Layout children ────────────────────────────────────────────────────
    // ── Layout children (use box.x/y which includes relative offset) ────
    const contentX = box.x + borderLeft + paddingLeft;
    const contentY = box.y + borderTop + paddingTop;

    let childY: number;

    if (fmtType === 'flex' || fmtType === 'inline-flex') {
      childY = this.layoutFlexContainer(node, contentX, contentY, contentWidth, fontSize, domTree);
    } else if (fmtType === 'grid' || fmtType === 'inline-grid') {
      childY = this.layoutGridContainer(node, contentX, contentY, contentWidth, fontSize, domTree);
    } else if (fmtType === 'table' || fmtType === 'inline-table') {
      childY = this.layoutTableContainer(node, contentX, contentY, contentWidth, fontSize, domTree);
    } else if (isBlock) {
      childY = this.layoutBlockChildren(node, contentX, contentY, contentWidth, fontSize, domTree);
    } else {
      childY = this.layoutInlineChildren(node, contentX, contentY, contentWidth, fontSize, domTree);
    }

    // Check for multi-column layout (applies to any block formatting context)
    const colCountRaw = style.get('column-count');
    const colWidthRaw = style.get('column-width');
    const hasColumns = (colCountRaw && colCountRaw !== 'auto') || (colWidthRaw && colWidthRaw !== 'auto');
    if (hasColumns) {
      const colGap = resolve('column-gap', '0');
      const colRuleW = this.parseBorderWidth(style.get('column-rule-width') ?? 'medium');
      let colCount = 1;
      let colWidthVal = 0;
      if (colCountRaw && colCountRaw !== 'auto') colCount = parseInt(colCountRaw, 10) || 1;
      if (colWidthRaw && colWidthRaw !== 'auto') colWidthVal = resolve('column-width', '0');
      const mcCtx = new MultiColumnFormattingContext({
        columnCount: colCount,
        columnWidth: colWidthVal,
        columnGap: colGap,
        columnRuleWidth: colRuleW,
        columnRuleStyle: style.get('column-rule-style') ?? 'none',
        columnRuleColor: style.get('column-rule-color') ?? 'currentcolor',
        availableWidth: contentWidth,
        availableHeight: null,
        fontSize,
      });
      const contentH = childY - contentY;
      mcCtx.resolve(contentH);
      this.multiColumnContexts.set(node.domId, mcCtx);
      box.height = Math.max(box.height, mcCtx.getTotalHeight() + paddingTop + paddingBottom + borderTop + borderBottom);
    }

    // ── Compute content height ────────────────────────────────────────────
    const contentHeight = Math.max(specifiedContentHeight, childY - contentY);

    // ── Update LayoutBox with final height ───────────────────────────────
    box.height = contentHeight + paddingTop + paddingBottom + borderTop + borderBottom;

    // ── Handle overflow: create scrollable container if needed ────────────
    const overflowX = style.get('overflow-x') ?? style.get('overflow') ?? 'visible';
    const overflowY = style.get('overflow-y') ?? style.get('overflow') ?? 'visible';
    if (overflowX === 'scroll' || overflowX === 'auto' || overflowY === 'scroll' || overflowY === 'auto') {
      const clientW = box.width - paddingLeft - paddingRight - borderLeft - borderRight;
      const clientH = box.height - paddingTop - paddingBottom - borderTop - borderBottom;
      const contentW = contentWidth;
      const contentH = contentHeight;
      const scrollW = Math.max(clientW, contentW);
      const scrollH = Math.max(clientH, contentH);
      const ox = overflowX === 'scroll' || (overflowX === 'auto' && contentW > clientW) ? 'scroll' : 'visible';
      const oy = overflowY === 'scroll' || (overflowY === 'auto' && contentH > clientH) ? 'scroll' : 'visible';
      if (ox !== 'visible' || oy !== 'visible') {
        const sc: import('./compositing/scroll-compositor').ScrollableContainer = {
          id: 'scroll-' + node.domId,
          elementId: node.domId,
          scrollX: 0,
          scrollY: 0,
          scrollWidth: scrollW,
          scrollHeight: scrollH,
          clientWidth: clientW,
          clientHeight: clientH,
          overflowX: ox as 'visible' | 'hidden' | 'scroll' | 'auto',
          overflowY: oy as 'visible' | 'hidden' | 'scroll' | 'auto',
          onScroll: null,
        };
        this.scrollContainers.set(node.domId, sc);
      }
    }

    // Write back to DOM tree so paint-engine can read it.
    if (domTree) {
      domTree.setLayoutBox(node, box);
    }

    // Return the next Y position after this element's margin box.
    return posY + box.height + marginBottom;
  }

  /**
   * Incremental version of layoutNode: skips clean subtrees, tracks damage.
   */
  private layoutNodeIncremental(
    node: DomElement,
    x: number,
    y: number,
    availableWidth: number,
    parentFontSize: number,
    domTree: IDomTree,
    damage: DamageTracker,
  ): number {
    const style = node.computedStyle ?? new Map();
    const display = style.get('display') ?? 'inline';
    if (display === 'none' && !node._dirtyLayout) return y;

    if (!node._dirtyLayout) {
      const existingBox = this.layoutBoxes.get(node.domId);
      if (existingBox) {
        const childContentY = existingBox.y + existingBox.borderTop + existingBox.paddingTop;
        let childY = childContentY;
        for (const child of node.children) {
          if (child.nodeType === 'element') {
            childY = this.layoutNodeIncremental(child as DomElement, x, childY, availableWidth, parentFontSize, domTree, damage);
          }
        }
        return existingBox.y + existingBox.height + existingBox.marginBottom;
      }
      return y;
    }

    const oldBox = this.layoutBoxes.get(node.domId);
    const newEndY = this.layoutNode(node, x, y, availableWidth, parentFontSize, domTree);
    const newBox = this.layoutBoxes.get(node.domId);
    if (newBox) {
      damage.addBox(newBox);
      if (oldBox) {
        const hasMoved = oldBox.x !== newBox.x || oldBox.y !== newBox.y;
        const hasResized = oldBox.width !== newBox.width || oldBox.height !== newBox.height;
        if (hasMoved || hasResized) {
          damage.addBox(oldBox);
        }
      }
    }

    domTree.clearSubtreeDirty(node, 'layout');
    domTree.clearSubtreeDirty(node, 'paint');
    return newEndY;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // BLOCK FORMATTING CONTEXT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Lays out children of a block-level element using a block formatting context.
   *
   * Per CSS 2.2 §9.2.1.1:
   * - Block-level children are stacked vertically.
   * - Inline-level children are wrapped in anonymous blocks.
   * - Adjacent vertical margins collapse (§8.3.1).
   */
  private layoutBlockChildren(
    parent: DomElement,
    contentX: number,
    contentY: number,
    availableWidth: number,
    parentFontSize: number,
    domTree?: IDomTree,
  ): number {
    const style = parent.computedStyle ?? new Map();
    const oldFloatContext = this.floatContext;

    // Create a float context for this BFC
    this.floatContext = new FloatContext(
      contentX,
      contentY,
      availableWidth,
      0, // height computed during layout
    );

    let childY = contentY;

    for (const child of parent.children) {
      if (child.nodeType === 'text') {
        childY += this.resolveLineHeight(style, parentFontSize);
        continue;
      }
      if (child.nodeType === 'element') {
        const childEl = child as DomElement;
        const childStyle = childEl.computedStyle ?? new Map();
        const childPos = childStyle.get('position') ?? 'static';

        // Absolute/fixed children: queue for positioned pass
        if (childPos === 'absolute' || childPos === 'fixed') {
          const childFontSize = this.resolveFontSize(childStyle, parentFontSize);
          const cb = childPos === 'fixed' ? null : findContainingBlockForScheme(childEl, childPos as 'absolute' | 'fixed' | 'sticky');
          this.positionedQueue.push({ element: childEl, containingBlock: cb, fontSize: childFontSize, availableWidth, domTree });
          continue;
        }

        // Handle float
        const floatVal = childStyle.get('float') ?? 'none';
        if (floatVal === 'left' || floatVal === 'right') {
          this.layoutFloatElement(childEl, floatVal as 'left' | 'right', contentX, childY, availableWidth, parentFontSize, domTree);
          continue;
        }

        // Handle clear — move below all floats on the cleared side
        const clearVal = childStyle.get('clear') ?? 'none';
        if (clearVal !== 'none') {
          childY = this.floatContext.getYAfterClear(clearVal as 'left' | 'right' | 'both' | 'none', childY);
        }

        childY = this.layoutNode(childEl, contentX, childY, availableWidth, parentFontSize, domTree);
      }
    }

    this.floatContext = oldFloatContext;
    return childY;
  }

  /**
   * Lays out a floated element.
   *
   * Per CSS 2.2 §9.5: A float is placed as far to the left (or right) as
   * possible, within the containing block's content area.
   */
  private layoutFloatElement(
    el: DomElement,
    side: 'left' | 'right',
    contentX: number,
    contentY: number,
    availableWidth: number,
    parentFontSize: number,
    domTree?: IDomTree,
  ): void {
    const elStyle = el.computedStyle ?? new Map();
    const elFontSize = this.resolveFontSize(elStyle, parentFontSize);

    // Resolve box model
    const resolve = (prop: string, fallback: string): number =>
      this.resolveLength(elStyle.get(prop) ?? fallback, elFontSize, availableWidth);

    const marginTop    = resolve('margin-top',    elStyle.get('margin') ?? '0');
    const marginRight  = resolve('margin-right',  elStyle.get('margin') ?? '0');
    const marginBottom = resolve('margin-bottom', elStyle.get('margin') ?? '0');
    const marginLeft   = resolve('margin-left',   elStyle.get('margin') ?? '0');

    const paddingTop    = resolve('padding-top',    elStyle.get('padding') ?? '0');
    const paddingRight  = resolve('padding-right',  elStyle.get('padding') ?? '0');
    const paddingBottom = resolve('padding-bottom', elStyle.get('padding') ?? '0');
    const paddingLeft   = resolve('padding-left',   elStyle.get('padding') ?? '0');

    const borderTop    = this.resolveBorder(elStyle, 'top');
    const borderRight  = this.resolveBorder(elStyle, 'right');
    const borderBottom = this.resolveBorder(elStyle, 'bottom');
    const borderLeft   = this.resolveBorder(elStyle, 'left');

    // Resolve width — floated elements shrink-wrap
    const boxSizing = elStyle.get('box-sizing') ?? 'content-box';
    const specWidth = elStyle.get('width');
    let borderWidthBox: number;

    if (specWidth && specWidth !== 'auto') {
      const specified = resolve('width', '0');
      if (boxSizing === 'border-box') {
        borderWidthBox = specified;
      } else {
        borderWidthBox = specified + paddingLeft + paddingRight + borderLeft + borderRight;
      }
    } else {
      // Auto width: shrink-wrap to content
      const contentWidth = availableWidth - marginLeft - marginRight - paddingLeft - paddingRight - borderLeft - borderRight;
      borderWidthBox = Math.max(0, contentWidth);
    }

    // Resolve height
    const specHeight = elStyle.get('height');
    let specifiedContentHeight: number;
    if (specHeight && specHeight !== 'auto') {
      if (boxSizing === 'border-box') {
        specifiedContentHeight = resolve('height', '0') - paddingTop - paddingBottom - borderTop - borderBottom;
      } else {
        specifiedContentHeight = resolve('height', '0');
      }
    } else {
      specifiedContentHeight = 0;
    }

    // Create preliminary box
    const box: LayoutBox = {
      x: 0,
      y: 0,
      width: borderWidthBox,
      height: 0,
      marginTop, marginRight, marginBottom, marginLeft,
      paddingTop, paddingRight, paddingBottom, paddingLeft,
      borderTop, borderRight, borderBottom, borderLeft,
    };

    // Layout children to determine height
    const contentWidth = borderWidthBox - paddingLeft - paddingRight - borderLeft - borderRight;
    const childContentX = contentX + borderLeft + paddingLeft;
    const childContentY = contentY + borderTop + paddingTop;

    let childY = contentY;
    const fmtType = classifyDisplay(elStyle.get('display') ?? 'block');

    if (fmtType === 'flex' || fmtType === 'inline-flex') {
      childY = this.layoutFlexContainer(el, childContentX, childContentY, contentWidth, elFontSize, domTree);
    } else if (fmtType === 'grid' || fmtType === 'inline-grid') {
      childY = this.layoutGridContainer(el, childContentX, childContentY, contentWidth, elFontSize, domTree);
    } else if (fmtType === 'block') {
      childY = this.layoutBlockChildren(el, childContentX, childContentY, contentWidth, elFontSize, domTree);
    } else {
      childY = this.layoutInlineChildren(el, childContentX, childContentY, contentWidth, elFontSize, domTree);
    }

    // Compute final height
    const contentHeight = Math.max(specifiedContentHeight, childY - childContentY);
    box.height = contentHeight + paddingTop + paddingBottom + borderTop + borderBottom;

    // Place the float
    if (this.floatContext) {
      this.floatContext.placeFloat(box, side, contentY);
    }

    // Register for hit testing
    this.layoutBoxes.set(el.domId, box);
    this.elementPositions.push({ element: el, box });

    // Write back to DOM tree
    if (domTree) {
      domTree.setLayoutBox(el, box);
    }
  }

  /**
   * Lays out an anonymous block containing inline-level children.
   *
   * This handles the case where a block container has inline-level children
   * mixed with block-level children. The inline content is wrapped in an
   * anonymous block box.
   */
  private layoutAnonymousBlock(
    children: Array<{ node: DomNode; display: string; isBlock: boolean }>,
    contentX: number,
    startY: number,
    availableWidth: number,
    parentFontSize: number,
    domTree?: IDomTree,
  ): number {
    const exclusionZones = this.floatContext?.getExclusionZones() ?? [];
    const ifc = new InlineFormattingContext(availableWidth, startY, {
      exclusionZones,
      defaultFontSize: parentFontSize,
    });

    for (const child of children) {
      if (child.node.nodeType === 'text') {
        const textNode = child.node as DomElement & { text?: string };
        const text = textNode.text ?? (child.node as { text: string }).text ?? '';
        if (text) {
          ifc.addTextRun(text, parentFontSize, this.resolveLineHeight(
            new Map(), parentFontSize,
          ), 'sans-serif');
        }
        continue;
      }

      if (child.node.nodeType !== 'element') continue;

      const el = child.node as DomElement;
      const elStyle = el.computedStyle ?? new Map();
      const elDisplay = elStyle.get('display') ?? 'inline';
      const elPosition = elStyle.get('position') ?? 'static';
      const elClassified = classifyDisplay(elDisplay);

      // Absolute/fixed children are removed from flow
      if (elPosition === 'absolute' || elPosition === 'fixed') {
        const containingBlock = elPosition === 'fixed' ? null : findContainingBlockForScheme(el, elPosition as 'absolute' | 'fixed' | 'sticky');
        const elFontSize = this.resolveFontSize(elStyle, parentFontSize);
        this.positionedQueue.push({ element: el, containingBlock, fontSize: elFontSize, availableWidth, domTree });
        continue;
      }

      if (elClassified === 'inline-block') {
        // Layout as inline-block: block formatting inside, inline positioning outside
        this.layoutInlineBlockElement(el, ifc, contentX, startY, availableWidth, parentFontSize, domTree);
      } else {
        // Regular inline element or text
        this.layoutInlineElement(el, ifc, contentX, startY, availableWidth, parentFontSize, domTree);
      }
    }

    const totalHeight = ifc.finalize();
    return startY + Math.max(totalHeight, this.resolveLineHeight(new Map(), parentFontSize));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // TABLE FORMATTING CONTEXT
  // ─────────────────────────────────────────────────────────────────────────

  private layoutTableContainer(
    parent: DomElement,
    contentX: number,
    contentY: number,
    availableWidth: number,
    parentFontSize: number,
    domTree?: IDomTree,
  ): number {
    const style = parent.computedStyle ?? new Map();
    const fontSize = this.resolveFontSize(style, parentFontSize);

    const resolve = (prop: string, fallback: string): number =>
      this.resolveLength(style.get(prop) ?? fallback, fontSize, availableWidth);

    const tableLayout = (style.get('table-layout') ?? 'auto') as 'auto' | 'fixed';
    const borderCollapse = (style.get('border-collapse') ?? 'separate') as 'separate' | 'collapse';
    const bs = resolve('border-spacing', '0');
    const borderSpacing = bs > 0 ? bs : 0;
    const captionSide = (style.get('caption-side') ?? 'top') as 'top' | 'bottom';

    const tblCtx = new TableFormattingContext({
      tableLayout,
      borderCollapse,
      borderSpacing,
      captionSide,
      availableWidth,
      fontSize,
    });

    const anonChildren = generateAnonymousTableBoxes(parent.children);

    const rowGroups: DomElement[] = [];
    const captions: DomElement[] = [];

    for (const child of anonChildren) {
      if (child.nodeType !== 'element') continue;
      const el = child as DomElement;
      if (!el.computedStyle) el.computedStyle = new Map();
      const display = el.computedStyle.get('display') ?? 'inline';
      const role = classifyTableChild(display);
      if (role === 'caption') {
        captions.push(el);
      } else if (role === 'row-group' || role === 'row') {
        rowGroups.push(el);
      }
    }

    tblCtx.addCaptions(captions);

    for (const rg of rowGroups) {
      const rgChildren = rg.computedStyle?.get('display') === 'table-row' ? [rg] : rg.children;
      for (const child of rgChildren) {
        if (child.nodeType !== 'element') continue;
        const rowEl = child as DomElement;
        if (!rowEl.computedStyle) rowEl.computedStyle = new Map();
        const rowDisplay = rowEl.computedStyle.get('display') ?? 'inline';
        if (classifyTableChild(rowDisplay) !== 'row') continue;
        const cells: Array<{ element: DomElement; row: number; col: number; rowspan: number; colspan: number; box: LayoutBox; contentWidth: number; contentHeight: number }> = [];
        let col = 0;
        for (const cellChild of rowEl.children) {
          if (cellChild.nodeType !== 'element') continue;
          const cellEl = cellChild as DomElement;
          if (!cellEl.computedStyle) cellEl.computedStyle = new Map();
          const cellDisplay = cellEl.computedStyle.get('display') ?? 'inline';
          if (classifyTableChild(cellDisplay) !== 'cell') continue;
          const colspan = parseInt(cellEl.attributes.get('colspan') ?? '1', 10) || 1;
          const rowspan = parseInt(cellEl.attributes.get('rowspan') ?? '1', 10) || 1;
          cells.push({
            element: cellEl,
            row: 0,
            col,
            rowspan,
            colspan,
            box: {
              x: 0, y: 0, width: 0, height: 0,
              marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
              paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
              borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
            },
            contentWidth: 0,
            contentHeight: 0,
          });
          col += colspan;
        }
        tblCtx.addRow(cells);
      }
    }

    tblCtx.resolve(
      (value: string, fallback: string) => this.resolveLength(value, fontSize, availableWidth),
    );

    tblCtx.layoutCells(
      contentX,
      contentY,
      (cellEl: DomElement, x: number, y: number, w: number, h: number) => {
        const cellBox: LayoutBox = {
          x, y,
          width: w, height: h,
          marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
          paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
          borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
        };
        this.layoutBoxes.set(cellEl.domId, cellBox);
        this.elementPositions.push({ element: cellEl, box: cellBox });
        if (domTree) domTree.setLayoutBox(cellEl, cellBox);
        this.layoutNode(cellEl, x, y, w, fontSize, domTree);
      },
    );

    return contentY + tblCtx.getTotalHeight();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // FLEX FORMATTING CONTEXT
  // ─────────────────────────────────────────────────────────────────────────

  private layoutFlexContainer(
    parent: DomElement,
    contentX: number,
    contentY: number,
    availableWidth: number,
    parentFontSize: number,
    domTree?: IDomTree,
  ): number {
    const style = parent.computedStyle ?? new Map();
    const fontSize = this.resolveFontSize(style, parentFontSize);

    const resolve = (prop: string, fallback: string): number =>
      this.resolveLength(style.get(prop) ?? fallback, fontSize, availableWidth);

    // ── Resolve container flex properties ────────────────────────────────
    const direction = (style.get('flex-direction') ?? 'row') as FlexDirection;
    const wrap = (style.get('flex-wrap') ?? 'nowrap') as FlexWrap;
    const justifyContent = (style.get('justify-content') ?? 'flex-start') as JustifyContent;
    const alignItems = (style.get('align-items') ?? 'stretch') as AlignItems;
    const alignContent = (style.get('align-content') ?? 'stretch') as AlignContent;
    const isHorizontal = isRowDirection(direction);

    const rowGap = resolve('row-gap', style.get('gap') ?? '0');
    const columnGap = resolve('column-gap', style.get('gap') ?? '0');
    const mainAxisGap = isHorizontal ? columnGap : rowGap;
    const crossAxisGap = isHorizontal ? rowGap : columnGap;

    // Resolve container cross size (height for row, width for column)
    const crossSizeProp = isHorizontal ? 'height' : 'width';
    let availableCrossSize: number | null = null;
    const rawCross = style.get(crossSizeProp);
    if (rawCross && rawCross !== 'auto') {
      availableCrossSize = resolve(crossSizeProp, '0');
    }

    // ── Collect flex items ───────────────────────────────────────────────
    const flexItems: FlexItem[] = [];

    for (const child of parent.children) {
      if (child.nodeType !== 'element') continue;
      const childEl = child as DomElement;
      const childStyle = childEl.computedStyle ?? new Map();
      const childDisplay = childStyle.get('display') ?? 'inline';
      if (childDisplay === 'none') continue;
      const childPos = childStyle.get('position') ?? 'static';
      if (childPos === 'absolute' || childPos === 'fixed') {
        // Queue for positioned layout after flex flow
        const containingBlock = childPos === 'fixed' ? null : findContainingBlockForScheme(childEl, childPos as 'absolute' | 'fixed' | 'sticky');
        const childFontSize = this.resolveFontSize(childStyle, fontSize);
        this.positionedQueue.push({ element: childEl, containingBlock, fontSize: childFontSize, availableWidth, domTree });
        continue;
      }

      const childFmtType = classifyDisplay(childDisplay);
      if (childFmtType === 'inline' || childFmtType === 'none') continue;

      const rc = (prop: string, fallback: string): number =>
        this.resolveLength(childStyle.get(prop) ?? fallback, fontSize, availableWidth);

      const item: FlexItem = {
        element: childEl,
        order: parseInt(childStyle.get('order') ?? '0', 10) || 0,
        flexGrow: parseFloat(childStyle.get('flex-grow') ?? '0') || 0,
        flexShrink: parseFloat(childStyle.get('flex-shrink') ?? '1') || 0,
        flexBasis: 0,
        mainSize: 0,
        crossSize: 0,
        mainOffset: 0,
        crossOffset: 0,
        marginLeft:   rc('margin-left',   childStyle.get('margin') ?? '0'),
        marginRight:  rc('margin-right',  childStyle.get('margin') ?? '0'),
        marginTop:    rc('margin-top',    childStyle.get('margin') ?? '0'),
        marginBottom: rc('margin-bottom', childStyle.get('margin') ?? '0'),
        paddingTop:    rc('padding-top',    childStyle.get('padding') ?? '0'),
        paddingRight:  rc('padding-right',  childStyle.get('padding') ?? '0'),
        paddingBottom: rc('padding-bottom', childStyle.get('padding') ?? '0'),
        paddingLeft:   rc('padding-left',   childStyle.get('padding') ?? '0'),
        borderTop:    this.parseBorderWidth(childStyle.get('border-top-width') ?? '0'),
        borderRight:  this.parseBorderWidth(childStyle.get('border-right-width') ?? '0'),
        borderBottom: this.parseBorderWidth(childStyle.get('border-bottom-width') ?? '0'),
        borderLeft:   this.parseBorderWidth(childStyle.get('border-left-width') ?? '0'),
        alignSelf: (childStyle.get('align-self') ?? 'auto') as AlignSelf,
        hasDefiniteCrossSize: false,
      };

      // Handle flex shorthand: flex: <grow> <shrink> <basis>
      const flexShorthand = childStyle.get('flex');
      if (flexShorthand) {
        const parts = flexShorthand.split(/\s+/);
        if (parts.length === 1) {
          const v = parseFloat(parts[0]);
          if (!isNaN(v)) { item.flexGrow = v; item.flexShrink = 1; item.flexBasis = 0; }
        } else if (parts.length === 2) {
          item.flexGrow = parseFloat(parts[0]) || 0;
          item.flexShrink = parseFloat(parts[1]) || 1;
          item.flexBasis = 0;
        } else if (parts.length >= 3) {
          item.flexGrow = parseFloat(parts[0]) || 0;
          item.flexShrink = parseFloat(parts[1]) || 1;
          item.flexBasis = parts[2] === 'auto' ? 0 : rc('flex-basis', '0');
        }
      }

      // Resolve flex-basis if not set by shorthand
      if (!flexShorthand || item.flexBasis === 0) {
        const childFlexBasis = childStyle.get('flex-basis');
        if (childFlexBasis && childFlexBasis !== 'auto') {
          item.flexBasis = rc('flex-basis', '0');
        } else {
          const mainSizeProp = isHorizontal ? 'width' : 'height';
          const rawMain = childStyle.get(mainSizeProp);
          if (rawMain && rawMain !== 'auto') {
            item.flexBasis = rc(mainSizeProp, '0');
          }
        }
      }

      // Check if item has explicit cross size
      const crossSizePropItem = isHorizontal ? 'height' : 'width';
      const rawItemCross = childStyle.get(crossSizePropItem);
      if (rawItemCross && rawItemCross !== 'auto') {
        item.hasDefiniteCrossSize = true;
        item.crossSize = rc(crossSizePropItem, '0');
      }

      flexItems.push(item);
    }

    if (flexItems.length === 0) return contentY;

    // ── Create flex context and resolve main sizes ──────────────────────
    const flexCtx = new FlexFormattingContext({
      direction, wrap, justifyContent, alignItems, alignContent,
      mainAxisGap, crossAxisGap,
      availableMainSize: availableWidth,
      availableCrossSize,
    });

    for (const item of flexItems) flexCtx.addItem(item);
    flexCtx.resolveMainSizes();

    // ── Compute positions (main + cross) ────────────────────────────────
    // First pass: preliminary positions using natural cross sizes
    flexCtx.computePositions();
    const itemsInLineOrder = flexCtx.getItemsInLineOrder();

    // ── Layout each item via layoutNode ─────────────────────────────────
    const mainSizeProp = isHorizontal ? 'width' : 'height';

    for (const item of itemsInLineOrder) {
      let borderBoxX: number;
      let borderBoxY: number;

      if (isHorizontal) {
        borderBoxX = contentX + item.mainOffset;
        borderBoxY = contentY + item.crossOffset;
      } else {
        borderBoxX = contentX + item.crossOffset;
        borderBoxY = contentY + item.mainOffset;
      }

      const itemAvailWidth = isHorizontal ? item.mainSize : availableWidth;

      // Temporarily override the main-axis size so layoutNode uses the
      // flex-computed mainSize instead of the element's explicit width/height.
      const origStyle = item.element.computedStyle;
      if (origStyle && item.mainSize > 0) {
        origStyle.set(mainSizeProp, `${item.mainSize}px`);
      }

      this.layoutNode(
        item.element,
        borderBoxX,
        borderBoxY,
        itemAvailWidth,
        fontSize,
        domTree,
      );
    }

    // ── Update cross sizes from actual layout ───────────────────────────
    flexCtx.updateCrossSizesFromLayout();

    // ── Recompute positions with correct cross sizes ────────────────────
    flexCtx.computePositions();
    const totalCrossSize = flexCtx.getTotalCrossSize();
    const finalItems = flexCtx.getItemsInLineOrder();

    // Reposition items using offsets computed by the flex algorithm
    for (const item of finalItems) {
      let finalX: number;
      let finalY: number;

      if (isHorizontal) {
        finalX = contentX + item.mainOffset;
        finalY = contentY + item.crossOffset;
      } else {
        finalX = contentX + item.crossOffset;
        finalY = contentY + item.mainOffset;
      }

      // Apply position: relative offsets (these were already applied by
      // layoutNode but get overwritten by the repositioning step).
      const itemStyle = item.element.computedStyle;
      if (itemStyle) {
        const itemPosition = itemStyle.get('position') ?? 'static';
        if (itemPosition === 'relative') {
          const relLeft = this.resolveLength(itemStyle.get('left') ?? '0', fontSize, availableWidth);
          const relTop = this.resolveLength(itemStyle.get('top') ?? '0', fontSize, availableWidth);
          finalX += relLeft;
          finalY += relTop;
        }
      }

      // Replace LayoutBox with repositioned copy
      const box = item.element.layoutBox;
      if (box) {
        const newBox: LayoutBox = {
          x: finalX,
          y: finalY,
          width: box.width,
          height: item.hasDefiniteCrossSize ? box.height : item.crossSize,
          marginTop: box.marginTop, marginRight: box.marginRight,
          marginBottom: box.marginBottom, marginLeft: box.marginLeft,
          paddingTop: box.paddingTop, paddingRight: box.paddingRight,
          paddingBottom: box.paddingBottom, paddingLeft: box.paddingLeft,
          borderTop: box.borderTop, borderRight: box.borderRight,
          borderBottom: box.borderBottom, borderLeft: box.borderLeft,
        };
        this.layoutBoxes.set(item.element.domId, newBox);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (item.element as any).layoutBox = newBox;
        for (let i = this.elementPositions.length - 1; i >= 0; i--) {
          if (this.elementPositions[i]!.element === item.element) {
            this.elementPositions[i]!.box = newBox;
            break;
          }
        }
      }
    }

    return contentY + totalCrossSize;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // GRID FORMATTING CONTEXT
  // ─────────────────────────────────────────────────────────────────────────

  private layoutGridContainer(
    parent: DomElement,
    contentX: number,
    contentY: number,
    availableWidth: number,
    parentFontSize: number,
    domTree?: IDomTree,
  ): number {
    const style = parent.computedStyle ?? new Map();
    const fontSize = this.resolveFontSize(style, parentFontSize);

    const resolve = (prop: string, fallback: string): number =>
      this.resolveLength(style.get(prop) ?? fallback, fontSize, availableWidth);

    // ── Resolve grid properties ──────────────────────────────────────────
    const colGap = resolve('column-gap', style.get('gap') ?? '0');
    const rowGap = resolve('row-gap', style.get('gap') ?? '0');

    const justifyContent = (style.get('justify-items') ?? 'stretch') as GridAxisAlign;
    const alignItems = (style.get('align-items') ?? 'stretch') as GridAxisAlign;

    // Parse grid-template-columns — use parseTrackList for repeat/minmax support
    const rawCols = style.get('grid-template-columns');
    const colDefs = rawCols && rawCols !== 'none' ? parseTrackList(rawCols) : [];
    const columns = colDefs.map(d => d.value);

    // Parse grid-template-rows
    const rawRows = style.get('grid-template-rows');
    const rowDefs = rawRows && rawRows !== 'none' ? parseTrackList(rawRows) : [];
    const rows = rowDefs.map(d => d.value);

    // Parse grid-template-areas
    const rawAreas = style.get('grid-template-areas');
    const templateAreas = rawAreas ? parseGridTemplateAreas(rawAreas) : { rows: [], columns: 0 };

    // If no explicit columns, auto-fill based on area count or at least 1
    if (columns.length === 0 && templateAreas.columns > 0) {
      for (let i = 0; i < templateAreas.columns; i++) columns.push('1fr');
    }
    if (columns.length === 0) columns.push('1fr');
    if (rows.length === 0) rows.push('auto');

    // Container height
    let availableHeight: number | null = null;
    const rawHeight = style.get('height');
    if (rawHeight && rawHeight !== 'auto') {
      availableHeight = resolve('height', '0');
    }

    // ── Collect grid items ───────────────────────────────────────────────
    const gridItems: GridItem[] = [];

    for (const child of parent.children) {
      if (child.nodeType !== 'element') continue;
      const childEl = child as DomElement;
      const childStyle = childEl.computedStyle ?? new Map();
      const childDisplay = childStyle.get('display') ?? 'inline';
      if (childDisplay === 'none') continue;
      const childPos = childStyle.get('position') ?? 'static';
      if (childPos === 'absolute' || childPos === 'fixed') {
        // Queue for positioned layout after grid flow
        const containingBlock = childPos === 'fixed' ? null : findContainingBlockForScheme(childEl, childPos as 'absolute' | 'fixed' | 'sticky');
        const childFontSize = this.resolveFontSize(childStyle, fontSize);
        this.positionedQueue.push({ element: childEl, containingBlock, fontSize: childFontSize, availableWidth, domTree });
        continue;
      }

      const childFmtType = classifyDisplay(childDisplay);
      if (childFmtType === 'inline' || childFmtType === 'none') continue;

      const rc = (prop: string, fallback: string): number =>
        this.resolveLength(childStyle.get(prop) ?? fallback, fontSize, availableWidth);

      // Parse grid-column / grid-row / grid-area
      const rawGridArea = childStyle.get('grid-area');
      const rawGridColumn = childStyle.get('grid-column');
      const rawGridRow = childStyle.get('grid-row');

      let colStart = -1, colEnd = -1, rowStart = -1, rowEnd = -1;

      if (rawGridArea) {
        const parsed = parseGridPlacement(rawGridArea, false);
        const parsedRow = parseGridPlacement(rawGridArea, true);
        colStart = parsed.start;
        colEnd = parsed.end;
        rowStart = parsedRow.start;
        rowEnd = parsedRow.end;
      } else {
        if (rawGridColumn) {
          const parsed = parseGridPlacement(rawGridColumn, false);
          colStart = parsed.start;
          colEnd = parsed.end;
        }
        if (rawGridRow) {
          const parsed = parseGridPlacement(rawGridRow, true);
          rowStart = parsed.start;
          rowEnd = parsed.end;
        }
      }

      // Try area-based placement
      if (rawGridArea && !rawGridColumn && !rawGridRow) {
        const areaPlacement = findAreaPlacement(rawGridArea, templateAreas);
        if (areaPlacement) {
          colStart = areaPlacement.colStart;
          colEnd = areaPlacement.colEnd;
          rowStart = areaPlacement.rowStart;
          rowEnd = areaPlacement.rowEnd;
        }
      }

      // Fallback: implicit placement
      if (colStart <= 0) colStart = -1;
      if (colEnd <= 0) colEnd = -1;
      if (rowStart <= 0) rowStart = -1;
      if (rowEnd <= 0) rowEnd = -1;

      // Check explicit width/height
      const rawW = childStyle.get('width');
      const rawH = childStyle.get('height');

      const item: GridItem = {
        element: childEl,
        placement: {
          columnStart: colStart,
          columnEnd: colEnd,
          rowStart: rowStart,
          rowEnd: rowEnd,
          isAutoColumn: colStart <= 0,
          isAutoRow: rowStart <= 0,
        },
        colOffset: 0,
        rowOffset: 0,
        areaWidth: 0,
        areaHeight: 0,
        marginLeft:   rc('margin-left',   childStyle.get('margin') ?? '0'),
        marginRight:  rc('margin-right',  childStyle.get('margin') ?? '0'),
        marginTop:    rc('margin-top',    childStyle.get('margin') ?? '0'),
        marginBottom: rc('margin-bottom', childStyle.get('margin') ?? '0'),
        paddingTop:    rc('padding-top',    childStyle.get('padding') ?? '0'),
        paddingRight:  rc('padding-right',  childStyle.get('padding') ?? '0'),
        paddingBottom: rc('padding-bottom', childStyle.get('padding') ?? '0'),
        paddingLeft:   rc('padding-left',   childStyle.get('padding') ?? '0'),
        borderTop:    this.parseBorderWidth(childStyle.get('border-top-width') ?? '0'),
        borderRight:  this.parseBorderWidth(childStyle.get('border-right-width') ?? '0'),
        borderBottom: this.parseBorderWidth(childStyle.get('border-bottom-width') ?? '0'),
        borderLeft:   this.parseBorderWidth(childStyle.get('border-left-width') ?? '0'),
        alignSelf: (childStyle.get('align-self') ?? 'auto') as GridSelfAlign,
        justifySelf: (childStyle.get('justify-self') ?? 'auto') as GridSelfAlign,
        hasExplicitWidth: !!rawW && rawW !== 'auto',
        hasExplicitHeight: !!rawH && rawH !== 'auto',
      };

      gridItems.push(item);
    }

    if (gridItems.length === 0) return contentY;

    // ── Create grid context and resolve ──────────────────────────────────
    const gridCtx = new GridFormattingContext({
      columns, rows,
      columnGap: colGap, rowGap: rowGap,
      availableWidth: availableWidth,
      availableHeight,
      fontSize,
      justifyItems: justifyContent,
      alignItems,
    });

    for (const item of gridItems) gridCtx.addItem(item);
    gridCtx.resolve();

    // ── Layout each item via layoutNode (first pass — get dimensions) ───
    // Pass the track start position; layoutNode will add margins internally.
    // We'll reposition after layout using the computed offsets.
    for (const item of gridItems) {
      // Compute available width for the item
      let itemAvailWidth = item.areaWidth;
      if (item.hasExplicitWidth) {
        const rawW = item.element.computedStyle?.get('width');
        itemAvailWidth = rawW && rawW !== 'auto'
          ? this.resolveLength(rawW, fontSize, availableWidth)
          : item.areaWidth;
      }

      // Temporarily override width if stretch
      const effJustify = item.justifySelf === 'auto' ? justifyContent : item.justifySelf;
      const origStyle = item.element.computedStyle;
      if (effJustify === 'stretch' && !item.hasExplicitWidth && origStyle) {
        const stretchWidth = item.areaWidth - item.marginLeft - item.marginRight
          - item.borderLeft - item.borderRight
          - item.paddingLeft - item.paddingRight;
        origStyle.set('width', `${Math.max(0, stretchWidth)}px`);
      }

      // Temporarily override height if stretch
      const effAlign = item.alignSelf === 'auto' ? alignItems : item.alignSelf;
      if (effAlign === 'stretch' && !item.hasExplicitHeight && origStyle) {
        const stretchHeight = item.areaHeight - item.marginTop - item.marginBottom
          - item.borderTop - item.borderBottom
          - item.paddingTop - item.paddingBottom;
        origStyle.set('height', `${Math.max(0, stretchHeight)}px`);
      }

      // Layout at a neutral position — dimensions are what matter
      this.layoutNode(
        item.element,
        contentX,
        contentY,
        itemAvailWidth,
        fontSize,
        domTree,
      );
    }

    // ── Reposition: overwrite each item's layoutBox with final position ─
    gridCtx.recomputeAlignmentForAutoSize();

    for (const item of gridItems) {
      const box = item.element.layoutBox;
      if (!box) continue;

      const newBox: LayoutBox = {
        x: contentX + item.colOffset,
        y: contentY + item.rowOffset,
        width: box.width,
        height: box.height,
        marginTop: box.marginTop, marginRight: box.marginRight,
        marginBottom: box.marginBottom, marginLeft: box.marginLeft,
        paddingTop: box.paddingTop, paddingRight: box.paddingRight,
        paddingBottom: box.paddingBottom, paddingLeft: box.paddingLeft,
        borderTop: box.borderTop, borderRight: box.borderRight,
        borderBottom: box.borderBottom, borderLeft: box.borderLeft,
      };
      this.layoutBoxes.set(item.element.domId, newBox);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (item.element as any).layoutBox = newBox;
      for (let i = this.elementPositions.length - 1; i >= 0; i--) {
        if (this.elementPositions[i]!.element === item.element) {
          this.elementPositions[i]!.box = newBox;
          break;
        }
      }
    }

    return contentY + gridCtx.getTotalHeight();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // INLINE FORMATTING CONTEXT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Lays out children of an inline-level element using an inline formatting context.
   *
   * Per CSS 2.2 §9.4.2:
   * - Inline-level boxes are laid out horizontally.
   * - Line boxes are created to contain the inline content.
   * - When a line box is full, a new one is started below.
   */
  private layoutInlineChildren(
    parent: DomElement,
    contentX: number,
    contentY: number,
    availableWidth: number,
    parentFontSize: number,
    domTree?: IDomTree,
  ): number {
    const exclusionZones = this.floatContext?.getExclusionZones() ?? [];
    const ifc = new InlineFormattingContext(availableWidth, contentY, {
      exclusionZones,
      defaultFontSize: parentFontSize,
    });

    for (const child of parent.children) {
      if (child.nodeType === 'text') {
        const text = (child as DomNode & { text: string }).text ?? '';
        if (text) {
          const lineHeight = this.resolveLineHeight(parent.computedStyle ?? new Map(), parentFontSize);
          ifc.addTextRun(text, parentFontSize, lineHeight, 'sans-serif');
        }
        continue;
      }

      if (child.nodeType !== 'element') continue;

      const el = child as DomElement;
      const elStyle = el.computedStyle ?? new Map();
      const elDisplay = elStyle.get('display') ?? 'inline';
      const elPosition = elStyle.get('position') ?? 'static';
      const elClassified = classifyDisplay(elDisplay);

      // Absolute/fixed children are removed from flow
      if (elPosition === 'absolute' || elPosition === 'fixed') {
        const containingBlock = elPosition === 'fixed' ? null : findContainingBlockForScheme(el, elPosition as 'absolute' | 'fixed' | 'sticky');
        const elFontSize = this.resolveFontSize(elStyle, parentFontSize);
        this.positionedQueue.push({ element: el, containingBlock, fontSize: elFontSize, availableWidth, domTree });
        continue;
      }

      if (elClassified === 'inline-block') {
        this.layoutInlineBlockElement(el, ifc, contentX, contentY, availableWidth, parentFontSize, domTree);
      } else if (elClassified === 'block') {
        // A block element inside an inline element creates a split:
        // CSS 2.2 §9.2.1.1: inline elements containing block-level children
        // are treated as if the element were replaced by its content.
        // For simplicity, we lay it out as a block within the inline context.
        const savedY = this.layoutNode(el, contentX, ifc.getEndY(), availableWidth, parentFontSize, domTree);
        // The block element breaks the line. We just advance the IFC.
      } else {
        this.layoutInlineElement(el, ifc, contentX, contentY, availableWidth, parentFontSize, domTree);
      }
    }

    const totalHeight = ifc.finalize();

    // Populate text runs on the parent's LayoutBox for painting
    this.populateTextRuns(parent, ifc, parentFontSize);

    return contentY + Math.max(totalHeight, this.resolveLineHeight(parent.computedStyle ?? new Map(), parentFontSize));
  }

  /**
   * Populates textRuns on a LayoutBox from an InlineFormattingContext.
   * The paint engine reads these to render actual text content.
   */
  private populateTextRuns(
    el: DomElement,
    ifc: InlineFormattingContext,
    fontSize: number,
  ): void {
    const box = this.layoutBoxes.get(el.domId);
    if (!box) return;

    const runs: TextRun[] = [];
    const elStyle = el.computedStyle ?? new Map();
    const color = elStyle.get('color') ?? '#000000';
    const fontFamily = elStyle.get('font-family') ?? 'sans-serif';
    const fontWeight = elStyle.get('font-weight') ?? 'normal';

    for (const line of ifc.lineBoxes) {
      for (const ilBox of line.boxes) {
        if (ilBox.textContent) {
          runs.push({
            text: ilBox.textContent,
            x: ilBox.box.x,
            y: ilBox.box.y + ilBox.baselineOffset,
            fontSize: ilBox.fontSize ?? fontSize,
            fontFamily: ilBox.fontFamily ?? fontFamily,
            fontWeight: ilBox.fontWeight ?? fontWeight,
            color,
          });
        }
      }
    }

    if (runs.length > 0) {
      box.textRuns = runs;
    }
  }

  /**
   * Lays out an inline-level element within an inline formatting context.
   */
  private layoutInlineElement(
    el: DomElement,
    ifc: InlineFormattingContext,
    contentX: number,
    contentY: number,
    availableWidth: number,
    parentFontSize: number,
    domTree?: IDomTree,
  ): void {
    const elStyle = el.computedStyle ?? new Map();
    const elDisplay = elStyle.get('display') ?? 'inline';
    const elFontSize = this.resolveFontSize(elStyle, parentFontSize);
    const lineHeight = this.resolveLineHeight(elStyle, elFontSize);

    // Compute the element's margin box width
    const resolve = (prop: string, fallback: string): number =>
      this.resolveLength(elStyle.get(prop) ?? fallback, elFontSize, availableWidth);

    const marginL = resolve('margin-left', elStyle.get('margin') ?? '0');
    const marginR = resolve('margin-right', elStyle.get('margin') ?? '0');
    const padL = resolve('padding-left', elStyle.get('padding') ?? '0');
    const padR = resolve('padding-right', elStyle.get('padding') ?? '0');
    const borderL = this.parseBorderWidth(elStyle.get('border-left-width') ?? '0');
    const borderR = this.parseBorderWidth(elStyle.get('border-right-width') ?? '0');

    const contentW = availableWidth - marginL - marginR - padL - padR - borderL - borderR;

    // Register the element with a preliminary box for hit testing
    const box: LayoutBox = {
      x: 0, y: 0, width: marginL + padL + borderL + contentW + borderR + padR + marginR,
      height: lineHeight,
      marginTop: 0, marginRight: marginR, marginBottom: 0, marginLeft: marginL,
      paddingTop: 0, paddingRight: padR, paddingBottom: 0, paddingLeft: padL,
      borderTop: 0, borderRight: borderR, borderBottom: 0, borderLeft: borderL,
    };

    // Add an inline-level box to the IFC
    const inlineBox = {
      element: el,
      box,
      baselineOffset: elFontSize * 0.8,
      isAnonymous: false,
    };

    ifc.addBox(inlineBox);

    // Register element for hit testing
    this.layoutBoxes.set(el.domId, box);
    this.elementPositions.push({ element: el, box });

    // Write back to DOM tree
    if (domTree) {
      domTree.setLayoutBox(el, box);
    }

    // If the inline element has children, layout them recursively
    if (el.children.length > 0) {
      const childHeight = this.layoutInlineChildren(el, contentX, contentY, contentW, elFontSize, domTree);
      box.height = Math.max(box.height, childHeight);
    }
  }

  /**
   * Lays out an inline-block element within an inline formatting context.
   *
   * An inline-block element (CSS 2.2 §9.6):
   * - Generates a block box that is flowed as a single inline-level box.
   * - Establishes a block formatting context inside.
   * - Has a definite width/height (or auto based on content).
   */
  private layoutInlineBlockElement(
    el: DomElement,
    ifc: InlineFormattingContext,
    contentX: number,
    contentY: number,
    availableWidth: number,
    parentFontSize: number,
    domTree?: IDomTree,
  ): void {
    const elStyle = el.computedStyle ?? new Map();
    const elFontSize = this.resolveFontSize(elStyle, parentFontSize);
    const lineHeight = this.resolveLineHeight(elStyle, elFontSize);

    // Resolve the element's width (for the inline box width)
    const resolve = (prop: string, fallback: string): number =>
      this.resolveLength(elStyle.get(prop) ?? fallback, elFontSize, availableWidth);

    const marginL = resolve('margin-left', elStyle.get('margin') ?? '0');
    const marginR = resolve('margin-right', elStyle.get('margin') ?? '0');
    const padL = resolve('padding-left', elStyle.get('padding') ?? '0');
    const padR = resolve('padding-right', elStyle.get('padding') ?? '0');
    const borderL = this.parseBorderWidth(elStyle.get('border-left-width') ?? '0');
    const borderR = this.parseBorderWidth(elStyle.get('border-right-width') ?? '0');

    const specWidth = elStyle.get('width');
    let innerWidth: number;
    if (specWidth && specWidth !== 'auto') {
      const specified = resolve('width', '0');
      const boxSizing = elStyle.get('box-sizing') ?? 'content-box';
      if (boxSizing === 'border-box') {
        innerWidth = Math.min(specified, availableWidth) - padL - padR - borderL - borderR;
      } else {
        innerWidth = Math.min(specified, availableWidth);
      }
    } else {
      innerWidth = availableWidth - marginL - marginR - padL - padR - borderL - borderR;
    }

    const totalWidth = marginL + padL + borderL + innerWidth + borderR + padR + marginR;

    // Create a preliminary box for hit testing
    const box: LayoutBox = {
      x: 0, y: 0,
      width: totalWidth,
      height: 0, // updated after internal layout
      marginTop: 0, marginRight: marginR, marginBottom: 0, marginLeft: marginL,
      paddingTop: 0, paddingRight: padR, paddingBottom: 0, paddingLeft: padL,
      borderTop: 0, borderRight: borderR, borderBottom: 0, borderLeft: borderL,
    };

    const inlineBox = {
      element: el,
      box,
      baselineOffset: elFontSize * 0.8,
      isAnonymous: false,
    };

    ifc.addBox(inlineBox);

    // Register element for hit testing
    this.layoutBoxes.set(el.domId, box);
    this.elementPositions.push({ element: el, box });

    // Write back to DOM tree
    if (domTree) {
      domTree.setLayoutBox(el, box);
    }

    // Layout children as block formatting context
    const childContentX = marginL + padL + borderL;
    const childContentY = 0;
    const childHeight = this.layoutBlockChildren(el, childContentX, childContentY, innerWidth, elFontSize, domTree);

    // Update height based on content
    const padT = resolve('padding-top', elStyle.get('padding') ?? '0');
    const padB = resolve('padding-bottom', elStyle.get('padding') ?? '0');
    const borderT = this.parseBorderWidth(elStyle.get('border-top-width') ?? '0');
    const borderB = this.parseBorderWidth(elStyle.get('border-bottom-width') ?? '0');

    const specHeight = elStyle.get('height');
    let contentHeight: number;
    if (specHeight && specHeight !== 'auto') {
      const boxSizing = elStyle.get('box-sizing') ?? 'content-box';
      if (boxSizing === 'border-box') {
        contentHeight = resolve('height', '0') - padT - padB - borderT - borderB;
      } else {
        contentHeight = resolve('height', '0');
      }
    } else {
      contentHeight = childHeight;
    }

    box.height = padT + borderT + contentHeight + borderB + padB;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UNIT RESOLUTION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Resolves a CSS length value to pixels.
   * Handles: px, em, rem, %, named font sizes, plain numbers.
   */
  private resolveLength(value: string, fontSize: number, containingWidth: number): number {
    if (!value || value === 'auto') return 0;

    const named = NAMED_FONT_SIZES[value];
    if (named !== undefined) return named;

    if (value.endsWith('px')) {
      const n = parseFloat(value);
      return isFinite(n) ? n : 0;
    }

    if (value.endsWith('em')) {
      const n = parseFloat(value);
      return isFinite(n) ? n * fontSize : 0;
    }

    if (value.endsWith('rem')) {
      const n = parseFloat(value);
      return isFinite(n) ? n * this.rootFontSize : 0;
    }

    if (value.endsWith('%')) {
      const n = parseFloat(value);
      return isFinite(n) ? (n / 100) * containingWidth : 0;
    }

    const n = parseFloat(value);
    return isFinite(n) ? n : 0;
  }

  private resolveFontSize(style: ReadonlyMap<string, string>, parentFontSize: number): number {
    const raw = style.get('font-size');
    if (!raw) return parentFontSize;

    const named = NAMED_FONT_SIZES[raw];
    if (named !== undefined) return named;

    if (raw.endsWith('em')) {
      const n = parseFloat(raw);
      return isFinite(n) ? n * parentFontSize : parentFontSize;
    }

    if (raw.endsWith('rem')) {
      const n = parseFloat(raw);
      return isFinite(n) ? n * this.rootFontSize : parentFontSize;
    }

    if (raw.endsWith('px')) {
      const n = parseFloat(raw);
      return isFinite(n) ? n : parentFontSize;
    }

    const n = parseFloat(raw);
    return isFinite(n) ? n : parentFontSize;
  }

  private resolveLineHeight(style: ReadonlyMap<string, string>, fontSize: number): number {
    const raw = style.get('line-height');
    if (!raw || raw === 'normal' || raw === 'auto') return fontSize * 1.2;

    if (!raw.endsWith('px') && !raw.endsWith('em') && !raw.endsWith('rem') && !raw.endsWith('%')) {
      const n = parseFloat(raw);
      return isFinite(n) ? n * fontSize : fontSize * 1.2;
    }

    return this.resolveLength(raw, fontSize, 0);
  }

  private parseBorderWidth(value: string): number {
    if (!value || value === 'none' || value === 'hidden') return 0;
    if (value === 'thin') return 1;
    if (value === 'medium') return 3;
    if (value === 'thick') return 5;
    return this.resolveLength(value, this.rootFontSize, 0);
  }

  /**
   * Resolve border-width respecting border-style: if the style is 'none' or
   * 'hidden', the width is 0 regardless of the specified width value.
   */
  private resolveBorder(style: ReadonlyMap<string, string>, side: 'top' | 'right' | 'bottom' | 'left'): number {
    // Check the per-side style first, then fall back to the shorthand
    const perSide = style.get(`border-${side}-style`);
    const shorthand = style.get('border-style');
    const styleVal = perSide ?? shorthand ?? 'none';
    if (styleVal === 'none' || styleVal === 'hidden') return 0;
    const w = style.get(`border-${side}-width`) ?? style.get('border-width') ?? 'medium';
    return this.parseBorderWidth(w);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POSITIONED ELEMENTS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Second-pass: lay out all absolutely/fixed-positioned elements that were
   * collected during normal flow. Per CSS 2.2 §10.3 and §10.5.
   */
  private layoutPositionedElements(): void {
    for (const entry of this.positionedQueue) {
      this.layoutSinglePositioned(entry.element, entry.containingBlock, entry.fontSize, entry.availableWidth, entry.domTree);
    }
    this.positionedQueue.length = 0;
  }

  private layoutSinglePositioned(
    node: DomElement,
    containingBlock: DomElement | null,
    fontSize: number,
    availableWidth: number,
    domTree?: IDomTree,
  ): void {
    const style = node.computedStyle ?? new Map();
    const display = style.get('display') ?? 'inline';

    if (display === 'none') return;

    const resolve = (prop: string, fallback: string): number =>
      this.resolveLength(style.get(prop) ?? fallback, fontSize, availableWidth);

    // ── Resolve box model ──────────────────────────────────────────────
    const marginLeft   = resolve('margin-left',   style.get('margin') ?? '0');
    const marginRight  = resolve('margin-right',  style.get('margin') ?? '0');
    const marginTop    = resolve('margin-top',    style.get('margin') ?? '0');
    const marginBottom = resolve('margin-bottom', style.get('margin') ?? '0');

    const paddingTop    = resolve('padding-top',    style.get('padding') ?? '0');
    const paddingRight  = resolve('padding-right',  style.get('padding') ?? '0');
    const paddingBottom = resolve('padding-bottom', style.get('padding') ?? '0');
    const paddingLeft   = resolve('padding-left',   style.get('padding') ?? '0');

    const borderTop    = this.parseBorderWidth(style.get('border-top-width') ?? '0');
    const borderRight  = this.parseBorderWidth(style.get('border-right-width') ?? '0');
    const borderBottom = this.parseBorderWidth(style.get('border-bottom-width') ?? '0');
    const borderLeft   = this.parseBorderWidth(style.get('border-left-width') ?? '0');

    // ── Determine initial width ────────────────────────────────────────
    const boxSizing = style.get('box-sizing') ?? 'content-box';
    const specWidth = style.get('width');
    let borderWidthBox: number;

    if (specWidth && specWidth !== 'auto') {
      const specified = resolve('width', '0');
      if (boxSizing === 'border-box') {
        borderWidthBox = specified;
      } else {
        borderWidthBox = specified + paddingLeft + paddingRight + borderLeft + borderRight;
      }
    } else {
      // Auto width: will be resolved by resolveOutOfFlow
      borderWidthBox = availableWidth;
    }

    // ── Register box at initial (0,0) — resolveOutOfFlow will reposition ─
    const box: LayoutBox = {
      x: 0,
      y: 0,
      width: borderWidthBox,
      height: 0,
      marginTop, marginRight, marginBottom, marginLeft,
      paddingTop, paddingRight, paddingBottom, paddingLeft,
      borderTop, borderRight, borderBottom, borderLeft,
    };
    this.layoutBoxes.set(node.domId, box);

    // ── Resolve positioning via positioning module ──────────────────────
    const cbBox = containingBlock ? (this.layoutBoxes.get(containingBlock.domId) ?? null) : null;
    resolveOutOfFlow(
      box,
      node,
      containingBlock,
      cbBox,
      this.config.viewportWidth,
      this.config.viewportHeight,
      fontSize,
    );

    // ── Layout children ────────────────────────────────────────────────
    const contentWidth = box.width - paddingLeft - paddingRight - borderLeft - borderRight;
    const contentX = box.x + borderLeft + paddingLeft;
    const contentY = box.y + borderTop + paddingTop;

    let childY: number;
    const fmtType = classifyDisplay(display);

    if (fmtType === 'flex' || fmtType === 'inline-flex') {
      childY = this.layoutFlexContainer(node, contentX, contentY, contentWidth, fontSize, domTree);
    } else if (fmtType === 'grid' || fmtType === 'inline-grid') {
      childY = this.layoutGridContainer(node, contentX, contentY, contentWidth, fontSize, domTree);
    } else if (fmtType === 'block') {
      childY = this.layoutBlockChildren(node, contentX, contentY, contentWidth, fontSize, domTree);
    } else {
      childY = this.layoutInlineChildren(node, contentX, contentY, contentWidth, fontSize, domTree);
    }

    // ── Resolve height ──────────────────────────────────────────────────
    const specHeight = style.get('height');
    const hasTop = style.get('top') !== undefined && style.get('top') !== 'auto';
    const hasBottom = style.get('bottom') !== undefined && style.get('bottom') !== 'auto';

    // If both top and bottom are set and no explicit height, resolveOutOfFlow
    // already stretched the height — don't overwrite it.
    if (hasTop && hasBottom && (!specHeight || specHeight === 'auto')) {
      // Height was already resolved by resolveOutOfFlow (top+bottom stretch)
    } else {
      let specifiedContentHeight: number;
      if (specHeight && specHeight !== 'auto') {
        if (boxSizing === 'border-box') {
          specifiedContentHeight = resolve('height', '0')
            - paddingTop - paddingBottom - borderTop - borderBottom;
        } else {
          specifiedContentHeight = resolve('height', '0');
        }
      } else {
        specifiedContentHeight = 0; // computed from children
      }

      const contentHeight = Math.max(specifiedContentHeight, childY - contentY);
      box.height = contentHeight + paddingTop + paddingBottom + borderTop + borderBottom;
    }

    // ── Handle auto margins for vertical centering ──────────────────────
    if (!specHeight || specHeight === 'auto') {
      const autoTop = style.get('top') === undefined || style.get('top') === 'auto';
      const autoBottom = style.get('bottom') === undefined || style.get('bottom') === 'auto';
      if (autoTop && autoBottom) {
        const cbHeight = cbBox
          ? cbBox.height - cbBox.borderTop - cbBox.borderBottom - cbBox.paddingTop - cbBox.paddingBottom
          : this.config.viewportHeight;
        const remaining = cbHeight - box.height - marginLeft - marginRight
          - borderLeft - borderRight - paddingLeft - paddingRight;
        const halfMargin = Math.max(0, remaining / 2);
        const cbY = cbBox
          ? cbBox.y + cbBox.borderTop + cbBox.paddingTop
          : 0;
        box.y = cbY + halfMargin + marginTop;
      }
    }

    // Update layoutBoxes with final values
    this.layoutBoxes.set(node.domId, box);

    // Write back to DOM tree
    if (domTree) {
      domTree.setLayoutBox(node, box);
    }
  }

  dispose(): void {
    this.layoutBoxes.clear();
    this.elementPositions.length = 0;
    this.positionedQueue.length = 0;
    this.multiColumnContexts.clear();
    this.scrollContainers.clear();
  }

  /** Expose the scroll container map for integration with the scroll compositor. */
  getScrollContainers(): ReadonlyMap<string, import('./compositing/scroll-compositor').ScrollableContainer> {
    return this.scrollContainers;
  }

  /** Get the multi-column context for a given element, if any. */
  getMultiColumnContext(domId: string): MultiColumnFormattingContext | undefined {
    return this.multiColumnContexts.get(domId);
  }
}

export { LayoutEngine, DEFAULT_LAYOUT_CONFIG };
export type { ILayoutEngine, LayoutConfig };
