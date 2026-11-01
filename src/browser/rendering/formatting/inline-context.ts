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

  /** Left edge of the containing block's content box; line x positions start here (like startY for y). */
  readonly originX: number;

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

  /** Owner stamped on the text segments of the addTextRun call in progress. */
  private textOwner: DomElement | null = null;

  constructor(
    availableWidth: number,
    startY: number,
    options?: {
      exclusionZones?: FloatExclusionZone[];
      defaultFontSize?: number;
      fontFamily?: string;
      fontWeight?: string;
      originX?: number;
    },
  ) {
    this.availableWidth = availableWidth;
    this.startY = startY;
    this.originX = options?.originX ?? 0;
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
  /**
   * The free span of a line at `y` (absolute) between the floats beside it, relative to originX.
   * The helpers below were called with the line's used *width* as their y and subtracted startY
   * from a float's x, so floats almost never narrowed a line: text after a floated image ran
   * underneath it.
   */
  private zoneBounds(y: number): { left: number; right: number } {
    let left = 0;
    let right = this.availableWidth;
    const bottom = y + this.defaultFontSize * 1.2;
    for (const zone of this.exclusionZones) {
      if (zone.y < bottom && zone.bottom > y) {
        if (zone.side === 'left') left = Math.max(left, zone.x - this.originX);
        else right = Math.min(right, zone.x - this.originX);
      }
    }
    left = Math.max(0, Math.min(left, this.availableWidth));
    return { left, right: Math.max(left, right) };
  }

  private getAvailableWidthAt(_y: number): number {
    const b = this.zoneBounds(this.currentLine.y);
    return b.right - b.left;
  }

  /**
   * Gets the X offset at a given Y position, accounting for left floats.
   */
  /** Lines are shifted past left floats in finalize(), once per line. */
  private getLeftOffsetAt(_y: number): number {
    return 0;
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

    // If this box doesn't fit, wrap to a new line. Any content counts, not only boxes: a line
    // holding just text never wrapped, so a width:100% inline-block sat after it and ran off the
    // page (Wikipedia's sister-project sidebar, 900px wide at x=645).
    if (this.currentLine.usedWidth + marginBoxWidth > availWidth &&
        this.currentLine.usedWidth > 0) {
      this.startNewLine();
    }

    // Position the box horizontally on the current line
    lb.x = this.originX + leftOffset + this.currentLine.usedWidth + lb.marginLeft;

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
    preserveWhitespace = false,
    owner: DomElement | null = null,
    /** white-space: nowrap / pre: lines break only at forced breaks (they used to wrap). */
    noWrap = false,
  ): void {
    if (!text) return;
    this.textOwner = owner;

    // Whitespace-only text: under white-space:normal it collapses to one space, which is dropped
    // at the start of a line. It used to be dropped unless it was exactly " ", so a newline or
    // two spaces between inline elements lost the word space entirely.
    const trimmed = text.trim();
    if (trimmed.length === 0 && text !== '\u00A0' && !preserveWhitespace) {
      if (this.currentLine.usedWidth === 0) return;
      text = ' ';
    }

    // white-space: normal collapses runs of spaces/tabs/newlines to one space (CSS Text §4.1.1);
    // source indentation used to show up as wide gaps mid-sentence. pre* keeps them, with tabs
    // advancing to the next 8-space stop (tab-size 8; a tab measured as nothing).
    if (!preserveWhitespace) text = text.replace(/[ \t\n\r\f]+/g, ' ');
    else if (text.includes('\t')) {
      let col = 0;
      text = text.replace(/[\t\n]|[^\t\n]+/g, (m) => {
        if (m === '\n') { col = 0; return m; }
        if (m === '\t') { const n = 8 - (col % 8); col += n; return ' '.repeat(n); }
        col += m.length;
        return m;
      });
    }

    const measurer = getTextMeasurer();
    const weight = fontWeight ?? this.fontWeight;
    const ff = fontFamily || this.fontFamily;

    // Segment text using UAX #14 break opportunities
    const segments = segmentText(text);

    for (const seg of segments) {
      if (seg.text.length === 0) continue;

      // white-space: pre/pre-wrap/pre-line keep newlines as forced breaks: a <pre> was one line.
      if (preserveWhitespace && /[\n\r]/.test(seg.text)) {
        const parts = seg.text.split(/\r\n|[\n\r]/);
        parts.forEach((part, k) => {
          if (k > 0) this.lineBreak(lineHeight);
          if (part) this.addTextRun(part, fontSize, lineHeight, fontFamily, fontWeight, preserveWhitespace, owner, noWrap);
        });
        continue;
      }

      // Is this a whitespace segment?
      const isWhitespace = /^\s+$/.test(seg.text);

      // Measure the text
      const ls = this.letterSpacing;
      const spaced = (t: string): number => (ls ? ls * [...t].length : 0); // letter-spacing adds after each character
      const metrics = measurer.measure(seg.text, fontSize, ff, weight);
      const segWidth = metrics.width + spaced(seg.text) + (isWhitespace ? this.wordSpacing : 0);

      // A word wider than the whole line breaks between characters when the style allows it.
      if (this.breakWords && !isWhitespace && segWidth > this.getAvailableWidthAt(0) - this.currentLine.usedWidth
        && (segWidth > this.getAvailableWidthAt(0) || this.currentLine.usedWidth === 0)) {
        this.pushBrokenWord(seg.text, fontSize, lineHeight, ff, weight);
        continue;
      }

      // Check if we need to wrap
      const availWidth = this.getAvailableWidthAt(this.currentLine.usedWidth);

      if (!noWrap && this.currentLine.usedWidth + segWidth > availWidth && this.currentLine.boxes.length > 0) {
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
          this.pushTextSegment(before, beforeMetrics.width + spaced(before), fontSize, lineHeight, ff);

          // Start new line with the remaining text
          this.startNewLine();

          if (after.length > 0) {
            const afterMetrics = measurer.measure(after, fontSize, ff, weight);
            this.pushTextSegment(after, afterMetrics.width + spaced(after), fontSize, lineHeight, ff);
          }
        } else {
          // No good break point — start a new line
          this.startNewLine();
          this.pushTextSegment(seg.text, segWidth, fontSize, lineHeight, ff);
        }
      } else {
        // Fits on current line
        // Skip leading whitespace on a new line (kept under pre*: indentation in a <pre>)
        if (isWhitespace && !preserveWhitespace && this.currentLine.boxes.length === 0 && this.currentLine.usedWidth === 0) {
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
        x: this.originX + this.currentLine.usedWidth,
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
      owner: this.textOwner,
      fontSize,
      fontFamily,
      ...(this.letterSpacing ? { letterSpacing: this.letterSpacing } : {}),
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
  finalize(textAlign = 'start'): number {
    let totalHeight = 0;
    const strutHeight = this.computeStrutHeight();

    for (const line of this.lineBoxes) {
      // Ensure minimum height of at least the strut height
      line.height = Math.max(line.height, strutHeight);

      // text-align (CSS Text §6.1): shift the line by its free space. Trailing spaces hang,
      // so they don't count. The line also starts past any left float beside it.
      // ponytail: justify is treated as start.
      const span = this.zoneBounds(line.y);
      const shift = span.left + this.alignmentShift(line, textAlign, span.right - span.left);
      if (shift > 0) for (const box of line.boxes) box.box.x += shift;

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

  private alignmentShift(line: LineBox, textAlign: string, lineWidth = this.availableWidth): number {
    const align = textAlign.replace(/^-webkit-/, '');
    if (align !== 'center' && align !== 'right' && align !== 'end') return 0;
    let used = line.usedWidth;
    for (let i = line.boxes.length - 1; i >= 0; i--) {
      const b = line.boxes[i]!;
      if (b.textContent === undefined || b.textContent.trim() !== '') break;
      used -= b.box.width;
    }
    const free = lineWidth - used;
    if (free <= 0) return 0;
    return align === 'center' ? free / 2 : free;
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

  /**
   * A forced line break (<br>, a preserved newline). An empty line still takes a line's height, so
   * `<br><br>` leaves a blank line.
   */
  lineBreak(lineHeight: number): void {
    if (this.currentLine.boxes.length === 0) this.currentLine.height = Math.max(this.currentLine.height, lineHeight);
    this.startNewLine();
  }

  /** letter-spacing (px) for the text added next; set by layout from the text's element. */
  letterSpacing = 0;
  /** word-spacing in px, added to each word separator. */
  wordSpacing = 0;
  /** overflow-wrap: anywhere / break-word, word-break: break-all — a word wider than the line breaks. */
  breakWords = false;

  /** text-indent: the first line starts this far in (CSS Text §8.1). It was ignored. */
  setTextIndent(px: number): void {
    if (this.lineBoxes.length === 1 && this.currentLine.boxes.length === 0) this.currentLine.usedWidth = px;
  }

  /**
   * Horizontal space on the current line: an inline element's left or right margin + border +
   * padding. They were ignored, so a padded `<span>` (badges, pill links) had its text flush against
   * its neighbours and its background drawn over them.
   */
  addSpace(px: number): void {
    if (px > 0) this.currentLine.usedWidth += px;
  }

  /** A word too wide for any line, broken between characters where it overflows. */
  private pushBrokenWord(text: string, fontSize: number, lineHeight: number, ff: string, weight: string): void {
    const measurer = getTextMeasurer();
    let rest = text;
    while (rest.length > 0) {
      const room = this.getAvailableWidthAt(0) - this.currentLine.usedWidth;
      let n = 1;
      while (n < rest.length && measurer.measure(rest.slice(0, n + 1), fontSize, ff, weight).width <= room) n++;
      if (measurer.measure(rest.slice(0, n), fontSize, ff, weight).width > room && this.currentLine.usedWidth > 0) {
        this.startNewLine();
        continue;
      }
      const piece = rest.slice(0, n);
      this.pushTextSegment(piece, measurer.measure(piece, fontSize, ff, weight).width, fontSize, lineHeight, ff);
      rest = rest.slice(n);
      if (rest.length > 0) this.startNewLine();
    }
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
