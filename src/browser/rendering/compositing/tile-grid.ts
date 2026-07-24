/**
 * @file TileGrid — 256×256 tile management for large compositing layers.
 *
 * Splits a layer into a grid of tiles. Only dirty tiles are re-rasterized.
 * Supports viewport culling to skip off-screen tiles.
 */

// ─────────────────────────────────────────────────────────────────────────────
// CONSTANTS
// ─────────────────────────────────────────────────────────────────────────────

export const TILE_SIZE = 256;

// ─────────────────────────────────────────────────────────────────────────────
// TYPES
// ─────────────────────────────────────────────────────────────────────────────

export interface ViewportRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface Tile {
  readonly col: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  isDirty: boolean;
  buffer: Uint8ClampedArray | null;
}

// ─────────────────────────────────────────────────────────────────────────────
// TILE GRID
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages a grid of tiles for a single compositing layer.
 *
 * Large layers (>512px in any dimension) are split into TILE_SIZE×TILE_SIZE tiles.
 * Only dirty tiles are re-rasterized on each frame.
 */
export class TileGrid {
  readonly tileWidth: number;
  readonly tileHeight: number;
  readonly cols: number;
  readonly rows: number;
  readonly layerWidth: number;
  readonly layerHeight: number;
  readonly layerId: string;

  private readonly tiles: Tile[];

  constructor(
    layerWidth: number,
    layerHeight: number,
    layerId: string,
    tileSize: number = TILE_SIZE,
  ) {
    this.tileWidth = tileSize;
    this.tileHeight = tileSize;
    this.layerWidth = layerWidth;
    this.layerHeight = layerHeight;
    this.layerId = layerId;

    this.cols = Math.ceil(layerWidth / tileSize) || 1;
    this.rows = Math.ceil(layerHeight / tileSize) || 1;

    this.tiles = [];
    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const x = col * tileSize;
        const y = row * tileSize;
        const w = Math.min(tileSize, layerWidth - x);
        const h = Math.min(tileSize, layerHeight - y);
        this.tiles.push({
          col,
          row,
          x,
          y,
          width: w,
          height: h,
          isDirty: true,
          buffer: null,
        });
      }
    }
  }

  /** Total number of tiles. */
  get tileCount(): number {
    return this.tiles.length;
  }

  /** All tiles (read-only view). */
  get allTiles(): readonly Tile[] {
    return this.tiles;
  }

  /**
   * Mark tiles intersecting the given damage region as dirty.
   * Coordinates are relative to the layer origin.
   */
  addDamage(x: number, y: number, w: number, h: number): void {
    const endX = x + w;
    const endY = y + h;

    const startCol = Math.max(0, Math.floor(x / this.tileWidth));
    const endCol = Math.min(this.cols - 1, Math.floor((endX - 1) / this.tileWidth));
    const startRow = Math.max(0, Math.floor(y / this.tileHeight));
    const endRow = Math.min(this.rows - 1, Math.floor((endY - 1) / this.tileHeight));

    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        this.tiles[row * this.cols + col]!.isDirty = true;
      }
    }
  }

  /** Get all dirty tiles. */
  getDirtyTiles(): Tile[] {
    return this.tiles.filter(t => t.isDirty);
  }

  /** Count of dirty tiles. */
  get dirtyCount(): number {
    let count = 0;
    for (const t of this.tiles) {
      if (t.isDirty) count++;
    }
    return count;
  }

  /**
   * Get tiles that intersect a viewport rectangle.
   * Viewport coordinates are in layer-local space.
   */
  getVisibleTiles(viewport: ViewportRect): Tile[] {
    const endX = viewport.x + viewport.width;
    const endY = viewport.y + viewport.height;

    const startCol = Math.max(0, Math.floor(viewport.x / this.tileWidth));
    const endCol = Math.min(this.cols - 1, Math.floor((endX - 1) / this.tileWidth));
    const startRow = Math.max(0, Math.floor(viewport.y / this.tileHeight));
    const endRow = Math.min(this.rows - 1, Math.floor((endY - 1) / this.tileHeight));

    const visible: Tile[] = [];
    for (let row = startRow; row <= endRow; row++) {
      for (let col = startCol; col <= endCol; col++) {
        visible.push(this.tiles[row * this.cols + col]!);
      }
    }
    return visible;
  }

  /** Get a specific tile by column and row. */
  getTile(col: number, row: number): Tile | null {
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return null;
    return this.tiles[row * this.cols + col]!;
  }

  /** Clear all dirty flags after rasterization. */
  clearDirtyFlags(): void {
    for (const t of this.tiles) {
      t.isDirty = false;
    }
  }

  /**
   * Flatten all tile buffers into a single layer buffer.
   * Returns null if no tiles have been rasterized.
   */
  flattenToBuffer(): Uint8ClampedArray | null {
    let hasAny = false;
    for (const t of this.tiles) {
      if (t.buffer) { hasAny = true; break; }
    }
    if (!hasAny) return null;

    const buf = new Uint8ClampedArray(this.layerWidth * this.layerHeight * 4);

    for (const tile of this.tiles) {
      if (!tile.buffer) continue;
      this.blitTileToBuffer(tile, buf);
    }

    return buf;
  }

  /**
   * Blit a single tile's buffer into a larger layer buffer.
   */
  private blitTileToBuffer(tile: Tile, layerBuf: Uint8ClampedArray): void {
    const src = tile.buffer!;
    const srcW = tile.width;
    const dstW = this.layerWidth;

    for (let row = 0; row < tile.height; row++) {
      const srcOff = (row * srcW) * 4;
      const dstOff = ((tile.y + row) * dstW + tile.x) * 4;
      const copyBytes = srcW * 4;
      layerBuf.set(src.subarray(srcOff, srcOff + copyBytes), dstOff);
    }
  }

  /** Dispose all tile buffers. */
  dispose(): void {
    for (const t of this.tiles) {
      t.buffer = null;
    }
  }
}
