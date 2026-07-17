import type { DomElement, LayoutBox } from '../dom-tree';
import type { FloatExclusionZone } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// FLOAT CONTEXT
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracks float state within a block formatting context.
 *
 * Per CSS 2.2 §9.5:
 * - A float is placed as far to the left (or right) as possible,
 *   but not past the margin edge of the float box's containing block.
 * - Content flows around floats.
 * - `clear` suppresses floats on the specified side.
 *
 * The FloatContext maintains a list of placed floats and provides
 * queries for available width and Y position at various vertical positions.
 */
export class FloatContext {
  /** The containing block's X position (border box left edge). */
  private readonly containingBlockX: number;
  /** The containing block's Y position (border box top edge). */
  private readonly containingBlockY: number;
  /** The containing block's content width. */
  private readonly containingBlockWidth: number;
  /** The containing block's content height (may be 0 during layout). */
  private readonly containingBlockHeight: number;

  /** All placed float boxes. */
  private readonly floats: PlacedFloat[] = [];

  /** The current bottom edge of the float area. */
  private currentBottom: number = 0;

  constructor(
    containingBlockX: number,
    containingBlockY: number,
    containingBlockWidth: number,
    containingBlockHeight: number,
  ) {
    this.containingBlockX = containingBlockX;
    this.containingBlockY = containingBlockY;
    this.containingBlockWidth = containingBlockWidth;
    this.containingBlockHeight = containingBlockHeight;
  }

  /**
   * Attempt to place a float element.
   *
   * Per CSS 2.2 §9.5.1, a float is placed at the highest position
   * that satisfies:
   * 1. Its top is at or below the top of the current line box
   * 2. It fits within the containing block's width
   * 3. It doesn't overlap any previously placed floats
   *
   * Returns the LayoutBox with updated x/y positions if placed,
   * or null if the float cannot be placed (e.g., floated left but
   * no room).
   */
  placeFloat(
    box: LayoutBox,
    side: 'left' | 'right',
    startY: number,
  ): LayoutBox | null {
    const marginBoxWidth = box.width + box.marginLeft + box.marginRight;
    const marginBoxHeight = box.height + box.marginTop + box.marginBottom;

    // Try to find a valid position
    let y = startY;

    // Scan downward until we find a position where the float fits
    for (let attempt = 0; attempt < 1000; attempt++) {
      const x = this.findValidX(side, marginBoxWidth, y);

      if (x !== null) {
        // Place the float
        box.x = x + box.marginLeft;
        box.y = y + box.marginTop;

        this.floats.push({
          x,
          y,
          width: marginBoxWidth,
          height: marginBoxHeight,
          side,
          box,
        });

        // Update current bottom
        this.currentBottom = Math.max(this.currentBottom, y + marginBoxHeight);

        return box;
      }

      // Move down to the next possible Y position
      y = this.getNextYBelow(y);
      if (y === this.currentBottom + 1) {
        // No more room — place at the bottom
        break;
      }
    }

    // Cannot find a valid position — place at the bottom edge
    const x = side === 'left'
      ? this.containingBlockX
      : this.containingBlockX + this.containingBlockWidth - marginBoxWidth;

    box.x = x + box.marginLeft;
    box.y = this.currentBottom + box.marginTop;

    this.floats.push({
      x,
      y: this.currentBottom,
      width: marginBoxWidth,
      height: marginBoxHeight,
      side,
      box,
    });

    this.currentBottom = this.currentBottom + marginBoxHeight;

    return box;
  }

  /**
   * Gets the available width at a given Y position.
   *
   * Accounts for all floats that overlap with this Y position.
   * The available width is the space between the rightmost left float
   * and the leftmost right float.
   */
  getAvailableWidth(y: number, height: number): number {
    let leftEdge = this.containingBlockX;
    let rightEdge = this.containingBlockX + this.containingBlockWidth;

    for (const f of this.floats) {
      // Check vertical overlap
      if (f.y < y + height && f.y + f.height > y) {
        if (f.side === 'left') {
          const fRight = f.x + f.width;
          leftEdge = Math.max(leftEdge, fRight);
        } else {
          const fLeft = f.x;
          rightEdge = Math.min(rightEdge, fLeft);
        }
      }
    }

    return Math.max(0, rightEdge - leftEdge);
  }

  /**
   * Gets the left offset at a given Y position (for left floats pushing content right).
   */
  getLeftOffset(y: number, height: number): number {
    let leftEdge = this.containingBlockX;

    for (const f of this.floats) {
      if (f.side === 'left' && f.y < y + height && f.y + f.height > y) {
        const fRight = f.x + f.width;
        leftEdge = Math.max(leftEdge, fRight);
      }
    }

    return leftEdge - this.containingBlockX;
  }

  /**
   * Gets the exclusion zones at a given Y position.
   * Used by InlineFormattingContext for line breaking.
   */
  getExclusionZones(): FloatExclusionZone[] {
    const zones: FloatExclusionZone[] = [];
    for (const f of this.floats) {
      zones.push({
        x: f.side === 'left' ? f.x + f.width : f.x,
        y: f.y,
        bottom: f.y + f.height,
        side: f.side,
      });
    }
    return zones;
  }

  /**
   * Gets the Y position after all floats (for positioning subsequent blocks).
   *
   * Per CSS 2.2 §9.5.2, the clear property determines where the
   * element's top margin edge is placed relative to the float.
   */
  getYAfterClear(clear: 'left' | 'right' | 'both' | 'none', currentY: number): number {
    if (clear === 'none') return currentY;

    let maxBottom = currentY;

    for (const f of this.floats) {
      if (f.side === 'left' && (clear === 'left' || clear === 'both')) {
        maxBottom = Math.max(maxBottom, f.y + f.height);
      }
      if (f.side === 'right' && (clear === 'right' || clear === 'both')) {
        maxBottom = Math.max(maxBottom, f.y + f.height);
      }
    }

    return maxBottom;
  }

  /**
   * Gets the current bottom of the float area.
   */
  getCurrentBottom(): number {
    return this.currentBottom;
  }

  /**
   * Gets all placed floats.
   */
  getFloats(): readonly PlacedFloat[] {
    return this.floats;
  }

  /**
   * Whether there are any floats.
   */
  hasFloats(): boolean {
    return this.floats.length > 0;
  }

  // ───────────────────────────────────────────────────────────────────────
  // PRIVATE
  // ───────────────────────────────────────────────────────────────────────

  /**
   * Find a valid X position for a float at a given Y.
   * Returns null if no valid position exists at this Y.
   */
  private findValidX(side: 'left' | 'right', width: number, y: number): number | null {
    const height = this.currentBottom > y ? this.currentBottom - y : width; // approximate
    const boxHeight = width; // use width as approximate height for float scanning

    if (side === 'left') {
      // Start at the left edge of the containing block
      let x = this.containingBlockX;

      // Scan right until we find a gap
      for (let attempt = 0; attempt < 100; attempt++) {
        if (x + width > this.containingBlockX + this.containingBlockWidth) {
          return null; // doesn't fit
        }

        if (!this.overlapsAny(x, y, width, boxHeight)) {
          return x;
        }

        // Move right past the overlapping float
        x = this.getNextXRight(x, y, boxHeight);
      }
    } else {
      // Start at the right edge of the containing block
      let x = this.containingBlockX + this.containingBlockWidth - width;

      for (let attempt = 0; attempt < 100; attempt++) {
        if (x < this.containingBlockX) {
          return null; // doesn't fit
        }

        if (!this.overlapsAny(x, y, width, boxHeight)) {
          return x;
        }

        // Move left past the overlapping float
        x = this.getNextXLeft(x, y, boxHeight);
      }
    }

    return null;
  }

  /**
   * Check if a rectangle overlaps any placed float.
   */
  private overlapsAny(x: number, y: number, width: number, height: number): boolean {
    for (const f of this.floats) {
      if (x < f.x + f.width &&
          x + width > f.x &&
          y < f.y + f.height &&
          y + height > f.y) {
        return true;
      }
    }
    return false;
  }

  /**
   * Get the next X position to the right that doesn't overlap any float at this Y.
   */
  private getNextXRight(currentX: number, y: number, height: number): number {
    let nextX = currentX + 1;

    for (const f of this.floats) {
      if (f.y < y + height && f.y + f.height > y) {
        if (f.x >= currentX && f.x < nextX + height) {
          nextX = f.x + f.width;
        }
      }
    }

    return nextX;
  }

  /**
   * Get the next X position to the left that doesn't overlap any float at this Y.
   */
  private getNextXLeft(currentX: number, y: number, height: number): number {
    let nextX = currentX - 1;

    for (const f of this.floats) {
      if (f.y < y + height && f.y + f.height > y) {
        if (f.x + f.width <= currentX + height && f.x + f.width > nextX) {
          nextX = f.x - height;
        }
      }
    }

    return nextX;
  }

  /**
   * Get the next Y position below all floats that overlap the given Y.
   */
  private getNextYBelow(y: number): number {
    let maxY = y + 1;

    for (const f of this.floats) {
      if (f.y <= y && f.y + f.height > y) {
        maxY = Math.max(maxY, f.y + f.height);
      }
    }

    return maxY;
  }
}

/**
 * Represents a placed float with its position and dimensions.
 */
export interface PlacedFloat {
  x: number;
  y: number;
  width: number;
  height: number;
  side: 'left' | 'right';
  box: LayoutBox;
}
