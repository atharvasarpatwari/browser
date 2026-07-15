import type { DomElement, DomNode, LayoutBox } from '../dom-tree';
import type { LineBox, InlineLevelBox } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// INLINE FORMATTING CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Represents the state of an inline formatting context being built.
 *
 * An inline formatting context (CSS 2.2 §9.4.2) lays out inline-level boxes
 * horizontally within line boxes. When a line box is full, a new one is started.
 */
export class InlineFormattingContext {
  /** All line boxes produced by this context. */
  readonly lineBoxes: LineBox[] = [];

  /** The available width for inline content (determines line breaks). */
  readonly availableWidth: number;

  /** The Y position where the first line box starts. */
  readonly startY: number;

  /** The current line box being filled. */
  private currentLine: LineBox;

  constructor(availableWidth: number, startY: number) {
    this.availableWidth = availableWidth;
    this.startY = startY;
    this.currentLine = this.createLineBox(startY);
  }

  /**
   * Adds an inline-level box to the current line.
   *
   * If the box doesn't fit on the current line (taking into account margins,
   * borders, and padding), a new line is started first.
   *
   * Returns the line box where the element was placed.
   */
  addBox(box: InlineLevelBox): LineBox {
    const el = box.element;
    const lb = box.box;

    // Calculate the total horizontal space this box needs
    const marginBoxWidth = lb.width + lb.marginLeft + lb.marginRight;

    // If this box doesn't fit, wrap to a new line
    if (this.currentLine.usedWidth + marginBoxWidth > this.availableWidth &&
        this.currentLine.boxes.length > 0) {
      this.startNewLine();
    }

    // Position the box horizontally on the current line
    const offsetX = this.currentLine.usedWidth + lb.marginLeft;

    // Update the line box with this element
    this.currentLine.boxes.push(box);
    this.currentLine.usedWidth += marginBoxWidth;

    return this.currentLine;
  }

  /**
   * Adds an anonymous text run to the current line.
   *
   * Splits text at word boundaries when it needs to wrap.
   */
  addTextRun(
    text: string,
    fontSize: number,
    lineHeight: number,
    fontFamily: string,
  ): void {
    if (!text || text.trim().length === 0 && text !== ' ') {
      // Whitespace-only text that isn't a single space: skip
      // But a single space should be rendered
      if (text !== ' ') return;
    }

    // Estimate character width: ~0.6 * fontSize for proportional fonts
    const charWidth = fontSize * 0.6;
    const spaceWidth = fontSize * 0.25;

    // Split into words for line breaking
    const words = text.split(/(\s+)/);

    for (const word of words) {
      if (word.length === 0) continue;

      const isSpace = /^\s+$/.test(word);
      const wordWidth = isSpace
        ? spaceWidth * word.length
        : charWidth * word.length;

      // Check if word fits on current line
      if (this.currentLine.usedWidth + wordWidth > this.availableWidth &&
          this.currentLine.boxes.length > 0) {
        // Don't break if the word is just a space at the start of a line
        if (isSpace && this.currentLine.boxes.length === 0) continue;
        this.startNewLine();
      }

      // Skip leading spaces on a new line
      if (isSpace && this.currentLine.boxes.length === 0 && this.currentLine.usedWidth === 0) {
        continue;
      }

      const box: InlineLevelBox = {
        element: null,
        box: {
          x: this.currentLine.usedWidth,
          y: this.startY + this.currentLine.y,
          width: wordWidth,
          height: lineHeight,
          marginTop: 0, marginRight: 0, marginBottom: 0, marginLeft: 0,
          paddingTop: 0, paddingRight: 0, paddingBottom: 0, paddingLeft: 0,
          borderTop: 0, borderRight: 0, borderBottom: 0, borderLeft: 0,
        },
        baselineOffset: fontSize * 0.8,
        isAnonymous: true,
        textContent: word,
      };

      this.currentLine.boxes.push(box);
      this.currentLine.usedWidth += wordWidth;
      this.currentLine.height = Math.max(this.currentLine.height, lineHeight);
    }
  }

  /**
   * Finalizes all line boxes, computing their final heights and
   * vertical positions.
   *
   * Returns the total height consumed by all line boxes.
   */
  finalize(): number {
    let totalHeight = 0;

    for (const line of this.lineBoxes) {
      // Ensure minimum height of at least the strut height
      line.height = Math.max(line.height, this.computeStrutHeight());
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
   */
  private computeStrutHeight(): number {
    return this.availableWidth > 0 ? 16 * 1.2 : 16 * 1.2;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// VERTICAL ALIGNMENT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Resolves a vertical-align keyword to a baseline offset from the
 * bottom of the line box.
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
