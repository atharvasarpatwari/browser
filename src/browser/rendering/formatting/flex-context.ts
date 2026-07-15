import type { DomElement, LayoutBox } from '../dom-tree';

// ─────────────────────────────────────────────────────────────────────────────
// FLEX TYPES
// ─────────────────────────────────────────────────────────────────────────────

export type FlexDirection = 'row' | 'row-reverse' | 'column' | 'column-reverse';
export type FlexWrap = 'nowrap' | 'wrap' | 'wrap-reverse';
export type JustifyContent = 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'space-evenly';
export type AlignItems = 'stretch' | 'flex-start' | 'flex-end' | 'center' | 'baseline';
export type AlignContent = 'flex-start' | 'flex-end' | 'center' | 'space-between' | 'space-around' | 'stretch';
export type AlignSelf = 'auto' | 'flex-start' | 'flex-end' | 'center' | 'baseline' | 'stretch';

export interface FlexItem {
  element: DomElement;
  order: number;
  flexGrow: number;
  flexShrink: number;
  flexBasis: number;

  mainSize: number;
  crossSize: number;
  mainOffset: number;
  crossOffset: number;

  marginLeft: number;
  marginRight: number;
  marginTop: number;
  marginBottom: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  borderTop: number;
  borderRight: number;
  borderBottom: number;
  borderLeft: number;

  alignSelf: AlignSelf;
  hasDefiniteCrossSize: boolean;
}

export interface FlexLine {
  items: FlexItem[];
  mainSize: number;
  crossSize: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// AXIS HELPERS
// ─────────────────────────────────────────────────────────────────────────────

export function isRowDirection(dir: FlexDirection): boolean {
  return dir === 'row' || dir === 'row-reverse';
}

function mainMarginStart(item: FlexItem, dir: FlexDirection): number {
  return isRowDirection(dir) ? item.marginLeft : item.marginTop;
}

function mainMarginEnd(item: FlexItem, dir: FlexDirection): number {
  return isRowDirection(dir) ? item.marginRight : item.marginBottom;
}

function crossMarginStart(item: FlexItem, dir: FlexDirection): number {
  return isRowDirection(dir) ? item.marginTop : item.marginLeft;
}

function crossMarginEnd(item: FlexItem, dir: FlexDirection): number {
  return isRowDirection(dir) ? item.marginBottom : item.marginRight;
}

function mainBorderPadding(item: FlexItem, dir: FlexDirection): number {
  if (isRowDirection(dir)) {
    return item.borderLeft + item.paddingLeft + item.borderRight + item.paddingRight;
  }
  return item.borderTop + item.paddingTop + item.borderBottom + item.paddingBottom;
}

function crossBorderPadding(item: FlexItem, dir: FlexDirection): number {
  if (isRowDirection(dir)) {
    return item.borderTop + item.paddingTop + item.borderBottom + item.paddingBottom;
  }
  return item.borderLeft + item.paddingLeft + item.borderRight + item.paddingRight;
}

// ─────────────────────────────────────────────────────────────────────────────
// FLEX FORMATTING CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

export interface FlexFormattingContextOptions {
  direction: FlexDirection;
  wrap: FlexWrap;
  justifyContent: JustifyContent;
  alignItems: AlignItems;
  alignContent: AlignContent;
  mainAxisGap: number;
  crossAxisGap: number;
  availableMainSize: number;
  availableCrossSize: number | null;
}

export class FlexFormattingContext {
  private readonly items: FlexItem[] = [];
  private readonly lines: FlexLine[] = [];
  private readonly options: FlexFormattingContextOptions;

  constructor(options: FlexFormattingContextOptions) {
    this.options = options;
  }

  addItem(item: FlexItem): void {
    this.items.push(item);
  }

  getItems(): readonly FlexItem[] {
    return this.items;
  }

  getLines(): readonly FlexLine[] {
    return this.lines;
  }

  /**
   * Returns items in the order they appear in flex lines.
   * For reverse directions, this is reversed DOM order within each line.
   */
  getItemsInLineOrder(): FlexItem[] {
    const result: FlexItem[] = [];
    for (const line of this.lines) {
      for (const item of line.items) {
        result.push(item);
      }
    }
    return result;
  }

  /**
   * Step 1-4: Sort by order, build lines, resolve main sizes (grow/shrink).
   */
  resolveMainSizes(): void {
    const { direction, wrap, mainAxisGap, availableMainSize } = this.options;

    // Step 1: Sort by order (stable)
    this.items.sort((a, b) => a.order - b.order);

    // Step 3: Build flex lines
    if (wrap === 'nowrap') {
      this.lines.push({ items: [...this.items], mainSize: 0, crossSize: 0 });
    } else {
      let currentLine: FlexLine = { items: [], mainSize: 0, crossSize: 0 };
      let usedSpace = 0;

      for (const item of this.items) {
        const itemMarginBox = item.flexBasis
          + mainMarginStart(item, direction)
          + mainMarginEnd(item, direction);

        if (currentLine.items.length > 0 &&
            usedSpace + itemMarginBox + mainAxisGap > availableMainSize) {
          this.lines.push(currentLine);
          currentLine = { items: [], mainSize: 0, crossSize: 0 };
          usedSpace = 0;
        }

        currentLine.items.push(item);
        usedSpace += itemMarginBox + (currentLine.items.length > 1 ? mainAxisGap : 0);
      }

      if (currentLine.items.length > 0) {
        this.lines.push(currentLine);
      }
    }

    // Step 3.5: For reverse directions, reverse items within each line
    // so the first DOM child ends up last visually.
    if (direction === 'row-reverse' || direction === 'column-reverse') {
      for (const line of this.lines) {
        line.items.reverse();
      }
    }

    // Step 4: Resolve flexible lengths per line
    for (const line of this.lines) {
      this.resolveLineMainSizes(line);
    }
  }

  /**
   * After layoutNode is called for each item, update cross sizes from
   * the actual laid-out boxes and recompute line cross sizes.
   */
  updateCrossSizesFromLayout(): void {
    const { direction } = this.options;

    for (const line of this.lines) {
      line.crossSize = 0;
      for (const item of line.items) {
        const box = item.element.layoutBox;
        if (box) {
          const naturalCross = isRowDirection(direction) ? box.height : box.width;
          item.crossSize = naturalCross;
        }
        const itemCrossMarginBox = item.crossSize
          + crossMarginStart(item, direction)
          + crossMarginEnd(item, direction);
        line.crossSize = Math.max(line.crossSize, itemCrossMarginBox);
      }
    }
  }

  /**
   * Compute cross-axis alignment (align-items, align-content) and
   * main-axis alignment (justify-content).
   * Returns items with final main/cross offsets.
   */
  computePositions(): FlexItem[] {
    const { direction, availableMainSize, availableCrossSize,
            alignContent, alignItems, justifyContent,
            mainAxisGap } = this.options;
    const { lines } = this;
    const totalLines = lines.length;
    const crossAxisGap = this.options.crossAxisGap;

    // Determine container cross size
    const linesCrossTotal = lines.reduce((s, l) => s + l.crossSize, 0)
      + Math.max(0, totalLines - 1) * crossAxisGap;

    const containerCrossSize = availableCrossSize ?? linesCrossTotal;

    // When align-content is stretch (default) and the container has a definite
    // cross size, stretch each line to fill it so that align-items: stretch/
    // flex-end/center work against the full container height.
    if (alignContent === 'stretch' && availableCrossSize !== null
        && availableCrossSize > 0 && lines.length > 0) {
      const lineShare = availableCrossSize / lines.length;
      for (const line of lines) {
        line.crossSize = lineShare;
      }
    }

    // Compute line cross offsets (for align-content)
    const lineCrossOffsets = this.computeLineCrossOffsets(
      lines, containerCrossSize, alignContent, crossAxisGap,
    );

    // Position each item
    for (let li = 0; li < lines.length; li++) {
      const line = lines[li]!;
      const lineCrossOff = lineCrossOffsets[li]!;

      // Per-line justify-content
      const lineJustifyOffset = computeJustifyOffset(
        line.mainSize, availableMainSize, justifyContent, line.items.length,
      );
      const lineJustifyGap = computeJustifyGap(
        line.mainSize, availableMainSize, justifyContent, line.items.length, mainAxisGap,
      );

      let runningMainOffset = lineJustifyOffset;

      for (const item of line.items) {
        const mStart = mainMarginStart(item, direction);
        const mEnd = mainMarginEnd(item, direction);

        // Main offset (includes justify-content)
        item.mainOffset = runningMainOffset + mStart;
        runningMainOffset += mStart + item.mainSize + mEnd + lineJustifyGap;

        // Cross offset based on align-self (or align-items)
        const effectiveAlign = item.alignSelf === 'auto' ? alignItems : item.alignSelf;
        const csStart = crossMarginStart(item, direction);

        switch (effectiveAlign) {
          case 'flex-start':
            item.crossOffset = lineCrossOff + csStart;
            break;
          case 'flex-end':
            item.crossOffset = lineCrossOff + line.crossSize
              - crossMarginEnd(item, direction) - item.crossSize;
            break;
          case 'center':
            item.crossOffset = lineCrossOff + csStart
              + (line.crossSize - csStart - crossMarginEnd(item, direction) - item.crossSize) / 2;
            break;
          case 'stretch':
            if (!item.hasDefiniteCrossSize) {
              item.crossSize = line.crossSize
                - crossMarginStart(item, direction)
                - crossMarginEnd(item, direction);
            }
            item.crossOffset = lineCrossOff + csStart;
            break;
          case 'baseline':
          default:
            item.crossOffset = lineCrossOff + csStart;
            break;
        }
      }
    }

    return this.items;
  }

  /**
   * Total cross-axis size consumed by all lines (for container height).
   */
  getTotalCrossSize(): number {
    const { crossAxisGap } = this.options;
    return this.lines.reduce((s, l) => s + l.crossSize, 0)
      + Math.max(0, this.lines.length - 1) * crossAxisGap;
  }

  // ───────────────────────────────────────────────────────────────────────
  // PRIVATE
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Resolve main sizes for a single flex line (grow/shrink).
   */
  private resolveLineMainSizes(line: FlexLine): void {
    const { direction, mainAxisGap, availableMainSize } = this.options;

    let totalFlexBasis = 0;
    let totalMainMargins = 0;
    let totalFlexGrow = 0;
    let totalFlexShrink = 0;

    for (const item of line.items) {
      totalFlexBasis += item.flexBasis;
      totalMainMargins += mainMarginStart(item, direction) + mainMarginEnd(item, direction);
      totalFlexGrow += item.flexGrow;
      totalFlexShrink += item.flexShrink;
    }

    const totalGaps = Math.max(0, line.items.length - 1) * mainAxisGap;
    const totalAllocated = totalFlexBasis + totalMainMargins + totalGaps;
    const freeSpace = availableMainSize - totalAllocated;

    if (freeSpace > 0 && totalFlexGrow > 0) {
      // Distribute positive free space proportionally via flex-grow
      for (const item of line.items) {
        item.mainSize = item.flexBasis
          + (item.flexGrow / totalFlexGrow) * freeSpace;
      }
    } else if (freeSpace < 0 && totalFlexShrink > 0) {
      // Shrink items proportionally via flex-shrink
      const shrinkTotal = -freeSpace;
      for (const item of line.items) {
        const shrinkAmount = (item.flexShrink / totalFlexShrink) * shrinkTotal;
        item.mainSize = Math.max(0, item.flexBasis - shrinkAmount);
      }
    } else {
      // No free space or no flex factors: use basis
      for (const item of line.items) {
        item.mainSize = item.flexBasis;
      }
    }

    // Clamp to 0
    for (const item of line.items) {
      if (item.mainSize < 0) item.mainSize = 0;
    }

    // Compute line main size (including gaps for free-space calculations)
    line.mainSize = 0;
    for (const item of line.items) {
      line.mainSize += mainMarginStart(item, direction)
        + item.mainSize
        + mainMarginEnd(item, direction);
    }
    line.mainSize += totalGaps;
  }

  /**
   * Compute the Y (cross-axis) offset for each flex line.
   */
  private computeLineCrossOffsets(
    lines: readonly FlexLine[],
    containerCrossSize: number,
    alignContent: AlignContent,
    crossAxisGap: number,
  ): number[] {
    const totalLinesCross = lines.reduce((s, l) => s + l.crossSize, 0)
      + Math.max(0, lines.length - 1) * crossAxisGap;

    const freeCrossSpace = containerCrossSize - totalLinesCross;
    const offsets: number[] = [];
    let runningCross = 0;

    switch (alignContent) {
      case 'flex-start':
        for (const line of lines) {
          offsets.push(runningCross);
          runningCross += line.crossSize + crossAxisGap;
        }
        break;

      case 'flex-end':
        runningCross = Math.max(0, freeCrossSpace);
        for (const line of lines) {
          offsets.push(runningCross);
          runningCross += line.crossSize + crossAxisGap;
        }
        break;

      case 'center':
        runningCross = Math.max(0, freeCrossSpace) / 2;
        for (const line of lines) {
          offsets.push(runningCross);
          runningCross += line.crossSize + crossAxisGap;
        }
        break;

      case 'space-between': {
        const gap = lines.length > 1 ? freeCrossSpace / (lines.length - 1) : 0;
        for (const line of lines) {
          offsets.push(runningCross);
          runningCross += line.crossSize + crossAxisGap + gap;
        }
        break;
      }

      case 'space-around': {
        const gap = lines.length > 0 ? freeCrossSpace / lines.length : 0;
        for (const line of lines) {
          runningCross += gap / 2;
          offsets.push(runningCross);
          runningCross += line.crossSize + gap / 2 + crossAxisGap;
        }
        break;
      }

      case 'stretch':
      default:
        // stretch: each line gets equal share of free space
        for (const line of lines) {
          offsets.push(runningCross);
          runningCross += line.crossSize + crossAxisGap;
        }
        break;
    }

    return offsets;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// JUSTIFY-CONTENT HELPER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Returns the initial main-axis offset for the first item in a flex line,
 * given the line's total main size, container main size, and justify-content.
 */
export function computeJustifyOffset(
  lineMainSize: number,
  containerMainSize: number,
  justify: JustifyContent,
  itemCount: number,
): number {
  const freeSpace = containerMainSize - lineMainSize;

  switch (justify) {
    case 'flex-end':
      return Math.max(0, freeSpace);
    case 'center':
      return Math.max(0, freeSpace) / 2;
    case 'space-between':
      return 0;
    case 'space-around':
      return itemCount > 0 ? Math.max(0, freeSpace) / (2 * itemCount) : 0;
    case 'space-evenly':
      return itemCount > 0 ? Math.max(0, freeSpace) / (itemCount + 1) : 0;
    case 'flex-start':
    default:
      return 0;
  }
}

/**
 * Returns the gap between items for space-between/space-around/space-evenly.
 */
export function computeJustifyGap(
  lineMainSize: number,
  containerMainSize: number,
  justify: JustifyContent,
  itemCount: number,
  baseGap: number,
): number {
  const freeSpace = containerMainSize - lineMainSize;

  switch (justify) {
    case 'space-between':
      return itemCount > 1 ? baseGap + freeSpace / (itemCount - 1) : baseGap;
    case 'space-around':
      return itemCount > 0 ? baseGap + freeSpace / itemCount : baseGap;
    case 'space-evenly':
      return itemCount > 0 ? baseGap + freeSpace / (itemCount + 1) : baseGap;
    default:
      return baseGap;
  }
}
