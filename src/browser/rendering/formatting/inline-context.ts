import type { DomElement, DomNode, LayoutBox } from '../dom-tree';
import type { LineBox, InlineLevelBox, FloatExclusionZone } from './types';
import { findBreakOpportunities, segmentText } from './line-break';
import { getTextMeasurer } from './text-measure';

// ─────────────────────────────────────────────────────────────────────────────
// INLINE FORMATTING CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents the state of an inline formatting context being built.
 *
 * An inline formatting context (CSS 2.2 §9.4.2) lays out inline-level boxes
 * horizontally within line boxes. When a line box is full, a new one is started.
 *
 * Supports:
 * - Proper Unicode line break opportunities (UAX #14)
 * - Text measurement via TextMeasurer
 * - Float exclusion zones (available width varies by Y position)
 * - Vertical alignment resolution across all boxes in a line
 * - Proper strut height computation
 */
export class InlineFormattingContext {
  /** All line boxes produced by this context. */
  readonly lineBoxes: LineBox[] = [];

  /** The available width for inline content (determines line breaks). */
  readonly availableWidth: number;

  /** The Y position where the first line box starts. */
  readonly startY: number;

  /** Float exclusion zones that affect available width. */
  private exclusionZones: FloatExclusionZone[] = [];

  /** The current line box being filled. */
  private currentLine: LineBox;

  /** Default font size for strut height. */
  private defaultFontSize: number;

  /** Font family to use for text measurement. */
  private fontFamily: string;

  /** Font weight for text measurement. */
  private fontWeight: string;

  constructor(
    availableWidth: number,
    startY: number,
    options?: {
      exclusionZones?: FloatExclusionZone[];
      defaultFontSize?: number;
      fontFamily?: string;
      fontWeight?: string;
    },
  ) {
    this.availableWidth = availableWidth;
    this.startY = startY;
    this.exclusionZones = options?.exclusionZones ?? [];
    this.defaultFontSize = options?.defaultFontSize ?? 16;
    this.fontFamily = options?.fontFamily ?? 'sans-serif';
    this.fontWeight = options?.fontWeight ?? 'normal';
    this.currentLine = this.createLineBox(startY);
  }

  /**
   * Set float exclusion zones (can be updated after construction).
   */
  setExclusionZones(zones: FloatExclusionZone[]): void {
    this.exclusionZones = zones;
  }

  /**
   * Gets the available width at a given Y position, accounting for floats.
   */
  private getAvailableWidthAt(y: number): number {
    let width = this.availableWidth;

    for (const zone of this.exclusionZones) {
      // Check if this zone overlaps with the Y position
      if (zone.y < this.startY + y + this.defaultFontSize * 1.2 && zone.bottom > this.startY + y) {
        if (zone.side === 'left') {
          // Left float pushes content right
          const rightEdge = zone.x;
          // The available width is reduced from the left
          width = Math.min(width, this.availableWidth - (this.availableWidth - rightEdge));
        } else {
          // Right float pushes content left
          width = Math.min(width, zone.x);
        }
      }
    }

    return Math.max(0, width);
  }

  /**
   * Gets the X offset at a given Y position, accounting for left floats.
   */
  private getLeftOffsetAt(y: number): number {
    let offset = 0;

    for (const zone of this.exclusionZones) {
      if (zone.side === 'left' &&
          zone.y < this.startY + y + this.defaultFontSize * 1.2 &&
          zone.bottom > this.startY + y) {
        offset = Math.max(offset, zone.x - this.startY);
      }
    }

    return offset;
  }

  /**
   * Adds an inline-level box to the current line.
   *
   * If the box doesn't fit on the current line, a new line is started.
   * Returns the line box where the element was placed.
   */
  addBox(box: InlineLevelBox): LineBox {
    const lb = box.box;

    const marginBoxWidth = lb.width + lb.marginLeft + lb.marginRight;
    const availWidth = this.getAvailableWidthAt(this.currentLine.usedWidth);
    const leftOffset = this.getLeftOffsetAt(this.currentLine.usedWidth);

    // If this box doesn't fit, wrap to a new line
    if (this.currentLine.usedWidth + marginBoxWidth > availWidth &&
        this.currentLine.boxes.length > 0) {
      this.startNewLine();
    }

    // Position the box horizontally on the current line
    lb.x = leftOffset + this.currentLine.usedWidth + lb.marginLeft;

    // Update the line box with this element
    this.currentLine.boxes.push(box);
    this.currentLine.usedWidth += marginBoxWidth;

    // Update line height
    const boxHeight = lb.height + lb.marginTop + lb.marginBottom;
    this.currentLine.height = Math.max(this.currentLine.height, boxHeight);
    this.currentLine.baseline = Math.max(this.currentLine.baseline, box.baselineOffset);

    return this.currentLine;
  }

  /**
   * Adds an anonymous text run to the current line.
   *
   * Uses proper Unicode line break opportunities (UAX #14) and
   * text measurement for accurate line breaking.
   */
  addTextRun(
    text: string,
    fontSize: number,
    lineHeight: number,
    fontFamily: string,
    fontWeight?: string,
  ): void {
    if (!text) return;

    // Whitespace-only text handling
    const trimmed = text.trim();
    if (trimmed.length === 0 && text !== ' ' && text !== '\u00A0') {
      return;
    }

    const measurer = getTextMeasurer();
    const weight = fontWeight ?? this.fontWeight;
    const ff = fontFamily || this.fontFamily;

    // Segment text using UAX #14 break opportunities
    const segments = segmentText(text);

    for (const seg of segments) {
      if (seg.text.length === 0) continue;

      // Is this a whitespace segment?
      const isWhitespace = /^\s+$/.test(seg.text);

      // Measure the text
      const metrics = measurer.measure(seg.text, fontSize, ff, weight);
      const segWidth = metrics.width;

      // Check if we need to wrap
      const availWidth = this.getAvailableWidthAt(this.currentLine.usedWidth);

      if (this.currentLine.usedWidth + segWidth > availWidth && this.currentLine.boxes.length > 0) {
        // We need to wrap. Try to find a good break point within this segment.
        if (isWhitespace) {
          // Just drop the whitespace at the end of the line (CSS 2.2 §16.6.1)
          continue;
        }

        // Try to find a break point within the text
        const remainingWidth = availWidth - this.currentLine.usedWidth;
        const breakIdx = this.findBestBreakPoint(seg.text, seg.start, remainingWidth, fontSize, ff, weight);

        if (breakIdx > 0 && breakIdx < seg.text.length) {
          // Break the text at this point
          const before = seg.text.slice(0, breakIdx);
          const after = seg.text.slice(breakIdx);

          const beforeMetrics = measurer.measure(before, fontSize, ff, weight);
          this.pushTextSegment(before, beforeMetrics.width, fontSize, lineHeight, ff);

          // Start new line with the remaining text
          this.startNewLine();

          if (after.length > 0) {
            const afterMetrics = measurer.measure(after, fontSize, ff, weight);
            this.pushTextSegment(after, afterMetrics.width, fontSize, lineHeight, ff);
          }
        } else {
          // No good break point — start a new line
          this.startNewLine();
          this.pushTextSegment(seg.text, segWidth, fontSize, lineHeight, ff);
        }
      } else {
        // Fits on current line
        // Skip leading whitespace on a new line
        if (isWhitespace && this.currentLine.boxes.length === 0 && this.currentLine.usedWidth === 0) {
          continue;
        }

        this.pushTextSegment(seg.text, segWidth, fontSize, lineHeight, ff);
      }
    }
  }

  /**
   * Find the best break point within a text segment that fits in the available width.
   * Returns the index in the text where we should break, or 0 if no good break exists.
   */
  private findBestBreakPoint(
    text: string,
    startOffset: number,
    availableWidth: number,
    fontSize: number,
    fontFamily: string,
    fontWeight: string,
  ): number {
    const opportunities = findBreakOpportunities(text);
    const measurer = getTextMeasurer();

    let bestIdx = 0;
    let bestWidth = 0;

    for (const opp of opportunities) {
      if (opp.index === 0) continue;

      const candidate = text.slice(0, opp.index);
      const metrics = measurer.measure(candidate, fontSize, fontFamily, fontWeight);

      if (metrics.width <= availableWidth && metrics.width > bestWidth) {
        bestWidth = metrics.width;
        bestIdx = opp.index;
      }
    }

    return bestIdx;
  }

  /**
   * Push a text segment as an InlineLevelBox onto the current line.
   */
  private pushTextSegment(
    text: string,
    width: number,
    fontSize: number,
    lineHeight: number,
    fontFamily: string,
  ): void {
    const box: InlineLevelBox = {
      element: null,
      box: {
        x: this.currentLine.usedWidth,
        y: this.startY + this.currentLine.y,
        width,
        height: lineHeight,
        marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
        paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
        borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
      },
      baselineOffset: fontSize * 0.8,
      isAnonymous: true,
      textContent: text,
      fontSize,
      fontFamily,
    };

    this.currentLine.boxes.push(box);
    this.currentLine.usedWidth += width;
    this.currentLine.height = Math.max(this.currentLine.height, lineHeight);
    this.currentLine.baseline = Math.max(this.currentLine.baseline, fontSize * 0.8);
  }

  /**
   * Finalizes all line boxes, computing their final heights and
   * vertical positions.
   *
   * Per CSS 2.2 §10.8, the height of each line box is determined by
   * the vertical alignment and height of its inline-level boxes.
   *
   * Returns the total height consumed by all line boxes.
   */
  finalize(): number {
    let totalHeight = 0;
    const strutHeight = this.computeStrutHeight();

    for (const line of this.lineBoxes) {
      // Ensure minimum height of at least the strut height
      line.height = Math.max(line.height, strutHeight);

      // Position each box vertically within the line box
      for (const box of line.boxes) {
        // Position relative to line box top
        const offsetFromTop = line.baseline - box.baselineOffset;
        box.box.y = line.y + Math.max(0, offsetFromTop);
      }

      totalHeight += line.height;
    }

    return totalHeight;
  }

  /**
   * Gets the total height of all line boxes.
   */
  getTotalHeight(): number {
    let total = 0;
    for (const line of this.lineBoxes) {
      total += line.height;
    }
    return total;
  }

  /**
   * Returns the Y position after all line boxes.
   */
  getEndY(): number {
    return this.startY + this.getTotalHeight();
  }

  // ───────────────────────────────────────────────────────────────────────
  // PRIVATE
  // ───────────────────────────────────────────────────────────────────────

  private createLineBox(yOffset: number): LineBox {
    const line: LineBox = {
      y: yOffset,
      height: 0,
      usedWidth: 0,
      baseline: 0,
      boxes: [],
    };
    this.lineBoxes.push(line);
    return line;
  }

  private startNewLine(): void {
    const lastLineHeight = this.currentLine.height || this.computeStrutHeight();
    const newY = this.currentLine.y + lastLineHeight;
    this.currentLine = this.createLineBox(newY);
  }

  /**
   * The strut height: the height of an anonymous inline box with
   * no content. It determines the minimum line box height.
   *
   * Per CSS 2.2 §10.8.1, the strut height is the normal line-height
   * of the element that establishes the IFC.
   */
  private computeStrutHeight(): number {
    return this.defaultFontSize * 1.2;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VERTICAL ALIGNMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a vertical-align keyword to a baseline offset from the
 * top of the line box.
 *
 * CSS 2.2 §10.8.1: vertical-align sets the vertical alignment of an
 * inline-level box within the line box.
 */
export function resolveVerticalAlign(
  value: string | undefined,
  fontSize: number,
  lineHeight: number,
): number {
  if (!value || value === 'baseline') {
    return fontSize * 0.8; // Approximate baseline from top
  }

  switch (value) {
    case 'top':
      return lineHeight;
    case 'bottom':
      return 0;
    case 'middle':
      return lineHeight / 2;
    case 'text-top':
      return fontSize;
    case 'text-bottom':
      return lineHeight - fontSize;
    case 'super':
      return fontSize * 1.2;
    case 'sub':
      return fontSize * 0.4;
    default: {
      // Try parsing as a length or percentage
      if (value.endsWith('%')) {
        const n = parseFloat(value) / 100;
        return isFinite(n) ? n * lineHeight : fontSize * 0.8;
      }
      if (value.endsWith('px')) {
        const n = parseFloat(value);
        return isFinite(n) ? n : fontSize * 0.8;
      }
      if (value.endsWith('em')) {
        const n = parseFloat(value);
        return isFinite(n) ? n * fontSize : fontSize * 0.8;
      }
      return fontSize * 0.8;
    }
  }
}
