import type { IDisposable } from '../../app/dependency-container';
import type { IDomTree, DomDocument, DomElement, DomNode, LayoutBox } from './dom-tree';
import { classifyDisplay, isBlockLevel } from './formatting/types';
import { classifyChildren, collapseMargins, isMarginCollapseBlocked } from './formatting/block-context';
import { InlineFormattingContext } from './formatting/inline-context';
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

  constructor(config?: Partial<LayoutConfig>) {
    this.config = { ...DEFAULT_LAYOUT_CONFIG, ...config };
    this.rootFontSize = this.config.defaultFontSize;
  }

  layout(document: DomDocument, domTree?: IDomTree, config?: Partial<LayoutConfig>): void {
    if (config) this.config = { ...this.config, ...config };
    this.rootFontSize = this.config.defaultFontSize;
    this.layoutBoxes.clear();
    this.elementPositions.length = 0;

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

    const borderTop    = this.parseBorderWidth(style.get('border-top-width') ?? '0');
    const borderRight  = this.parseBorderWidth(style.get('border-right-width') ?? '0');
    const borderBottom = this.parseBorderWidth(style.get('border-bottom-width') ?? '0');
    const borderLeft   = this.parseBorderWidth(style.get('border-left-width') ?? '0');

    // ── Resolve width ─────────────────────────────────────────────────────
    const boxSizing = style.get('box-sizing') ?? 'content-box';
    const specWidth = style.get('width');

    let borderWidthBox: number;
    if (specWidth && specWidth !== 'auto') {
      const specified = resolve('width', '0');
      if (boxSizing === 'border-box') {
        borderWidthBox = Math.min(specified, availableWidth);
      } else {
        borderWidthBox = specified + paddingLeft + paddingRight + borderLeft + borderRight;
        borderWidthBox = Math.min(borderWidthBox, availableWidth);
      }
    } else {
      borderWidthBox = availableWidth;
    }

    // ── Resolve height ────────────────────────────────────────────────────
    const specHeight = style.get('height');
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

    // ── Position the border box ───────────────────────────────────────────
    let posX = x + marginLeft;
    let posY: number;

    if (position === 'relative') {
      const top  = resolve('top', '0');
      const left = resolve('left', '0');
      posX += left;
      posY = y + marginTop + top;
    } else {
      posY = y + marginTop;
    }

    // ── Content area dimensions ───────────────────────────────────────────
    const contentWidth  = borderWidthBox - paddingLeft - paddingRight - borderLeft - borderRight;

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

    // ── Layout children ────────────────────────────────────────────────────
    const contentX = posX + borderLeft + paddingLeft;
    const contentY = posY + borderTop + paddingTop;

    let childY: number;

    if (fmtType === 'flex' || fmtType === 'inline-flex') {
      childY = this.layoutFlexContainer(node, contentX, contentY, contentWidth, fontSize, domTree);
    } else if (fmtType === 'grid' || fmtType === 'inline-grid') {
      childY = this.layoutGridContainer(node, contentX, contentY, contentWidth, fontSize, domTree);
    } else if (isBlock) {
      childY = this.layoutBlockChildren(node, contentX, contentY, contentWidth, fontSize, domTree);
    } else {
      childY = this.layoutInlineChildren(node, contentX, contentY, contentWidth, fontSize, domTree);
    }

    // ── Compute content height ────────────────────────────────────────────
    const contentHeight = Math.max(specifiedContentHeight, childY - contentY);

    // ── Update LayoutBox with final height ───────────────────────────────
    box.height = contentHeight + paddingTop + paddingBottom + borderTop + borderBottom;

    // Write back to DOM tree so paint-engine can read it.
    if (domTree) {
      domTree.setLayoutBox(node, box);
    }

    // Return the next Y position after this element's margin box.
    return posY + box.height + marginBottom;
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
    let childY = contentY;

    for (const child of parent.children) {
      if (child.nodeType === 'text') {
        childY += this.resolveLineHeight(style, parentFontSize);
        continue;
      }
      if (child.nodeType === 'element') {
        const childEl = child as DomElement;
        childY = this.layoutNode(childEl, contentX, childY, availableWidth, parentFontSize, domTree);
      }
    }

    return childY;
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
    const ifc = new InlineFormattingContext(availableWidth, startY);

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
      const elClassified = classifyDisplay(elDisplay);

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
      if (childPos === 'absolute' || childPos === 'fixed') continue;

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
      if (childPos === 'absolute' || childPos === 'fixed') continue;

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
    const ifc = new InlineFormattingContext(availableWidth, contentY);

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
      const elClassified = classifyDisplay(elDisplay);

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
    return contentY + Math.max(totalHeight, this.resolveLineHeight(parent.computedStyle ?? new Map(), parentFontSize));
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

  dispose(): void {
    this.layoutBoxes.clear();
    this.elementPositions.length = 0;
  }
}

export { LayoutEngine, DEFAULT_LAYOUT_CONFIG };
export type { ILayoutEngine, LayoutConfig };
