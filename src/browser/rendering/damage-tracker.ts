import type { LayoutBox } from './dom-tree';

// ─────────────────────────────────────────────────────────────────────────────
// DAMAGE RECT
// ─────────────────────────────────────────────────────────────────────────────

export interface DamageRect {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// DAMAGE TRACKER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tracks the union of dirty (damaged) rectangles on screen.
 *
 * When an element's layout or paint changes, its bounding box is added as a
 * damage region. Before rasterization the caller reads `getRegions()` to know
 * which areas of the framebuffer need re-drawing.
 *
 * The tracker does NOT merge overlapping regions (keeps it O(n) insert).
 * Call `compact()` to merge if the list grows large.
 */
export class DamageTracker {
  private regions: DamageRect[] = [];

  // ── Recording ──────────────────────────────────────────────────────

  /** Add an explicit rectangle to the damage set. */
  addRect(x: number, y: number, w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.regions.push({ x, y, w, h });
  }

  /** Convenience: add a LayoutBox as a damage region. */
  addBox(box: LayoutBox): void {
    this.addRect(box.x, box.y, box.width, box.height);
  }

  // ── Queries ────────────────────────────────────────────────────────

  /** The raw list of damage rectangles (may overlap). */
  getRegions(): readonly DamageRect[] {
    return this.regions;
  }

  /** Whether any damage has been recorded. */
  isEmpty(): boolean {
    return this.regions.length === 0;
  }

  /** Number of individual damage rects. */
  get count(): number {
    return this.regions.length;
  }

  /**
   * The smallest axis-aligned rectangle that covers all damage regions.
   * Returns null if there is no damage.
   */
  getBounds(): DamageRect | null {
    if (this.regions.length === 0) return null;
    let minX = Infinity, minY = Infinity;
    let maxX = -Infinity, maxY = -Infinity;
    for (const r of this.regions) {
      if (r.x < minX) minX = r.x;
      if (r.y < minY) minY = r.y;
      if (r.x + r.w > maxX) maxX = r.x + r.w;
      if (r.y + r.h > maxY) maxY = r.y + r.h;
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }

  /**
   * Returns true if the given rectangle intersects any damage region.
   */
  intersects(x: number, y: number, w: number, h: number): boolean {
    for (const r of this.regions) {
      if (r.x < x + w && r.x + r.w > x && r.y < y + h && r.y + r.h > y) {
        return true;
      }
    }
    return false;
  }

  // ── Mutation ───────────────────────────────────────────────────────

  /** Merge overlapping / adjacent damage rects to shrink the list. */
  compact(): void {
    if (this.regions.length <= 1) return;

    let merged = true;
    let current = [...this.regions];

    while (merged) {
      merged = false;
      const next: DamageRect[] = [];
      const used = new Set<number>();

      for (let i = 0; i < current.length; i++) {
        if (used.has(i)) continue;
        let r = current[i]!;

        for (let j = i + 1; j < current.length; j++) {
          if (used.has(j)) continue;
          const s = current[j]!;

          if (r.x <= s.x + s.w && r.x + r.w >= s.x &&
              r.y <= s.y + s.h && r.y + r.h >= s.y) {
            const nx = Math.min(r.x, s.x);
            const ny = Math.min(r.y, s.y);
            const nw = Math.max(r.x + r.w, s.x + s.w) - nx;
            const nh = Math.max(r.y + r.h, s.y + s.h) - ny;
            r = { x: nx, y: ny, w: nw, h: nh };
            used.add(j);
            merged = true;
          }
        }
        next.push(r);
      }
      current = next;
    }
    this.regions = current;
  }

  /** Remove all damage regions. */
  clear(): void {
    this.regions.length = 0;
  }

  /**
   * Add all regions from another DamageTracker to this one.
   */
  addRegionIntersection(other: DamageTracker): void {
    for (const r of other.regions) {
      this.regions.push(r);
    }
  }

  /** Release all tracked regions. */
  dispose(): void {
    this.clear();
  }
}
