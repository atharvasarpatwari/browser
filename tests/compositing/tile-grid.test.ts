import { describe, it, expect } from 'vitest';
import { TileGrid, TILE_SIZE } from '@/browser/rendering/compositing/tile-grid';

describe('TileGrid', () => {
  describe('construction', () => {
    it('creates correct grid for small layer', () => {
      const grid = new TileGrid(100, 100, 'test');
      expect(grid.cols).toBe(1);
      expect(grid.rows).toBe(1);
      expect(grid.tileCount).toBe(1);
    });

    it('creates correct grid for 512x512 layer', () => {
      const grid = new TileGrid(512, 512, 'test');
      expect(grid.cols).toBe(2);
      expect(grid.rows).toBe(2);
      expect(grid.tileCount).toBe(4);
    });

    it('creates correct grid for non-aligned size', () => {
      const grid = new TileGrid(300, 600, 'test');
      expect(grid.cols).toBe(2); // ceil(300/256) = 2
      expect(grid.rows).toBe(3); // ceil(600/256) = 3
      expect(grid.tileCount).toBe(6);
    });

    it('all tiles start dirty', () => {
      const grid = new TileGrid(512, 256, 'test');
      expect(grid.dirtyCount).toBe(2); // 2 cols × 1 row
    });

    it('tile dimensions are correct', () => {
      const grid = new TileGrid(300, 300, 'test');
      // Tile (0,0): 256x256
      expect(grid.getTile(0, 0)!.width).toBe(256);
      expect(grid.getTile(0, 0)!.height).toBe(256);
      // Tile (1,0): 44x256 (300-256=44)
      expect(grid.getTile(1, 0)!.width).toBe(44);
      expect(grid.getTile(1, 0)!.height).toBe(256);
    });
  });

  describe('addDamage', () => {
    it('marks correct tiles dirty', () => {
      const grid = new TileGrid(512, 512, 'test');
      grid.clearDirtyFlags();
      expect(grid.dirtyCount).toBe(0);

      // Damage in tile (0,0) only
      grid.addDamage(10, 10, 50, 50);
      expect(grid.dirtyCount).toBe(1);
      expect(grid.getTile(0, 0)!.isDirty).toBe(true);
      expect(grid.getTile(1, 0)!.isDirty).toBe(false);
    });

    it('marks multiple tiles dirty across boundary', () => {
      const grid = new TileGrid(512, 512, 'test');
      grid.clearDirtyFlags();

      // Damage crosses tile boundary
      grid.addDamage(200, 200, 200, 200);
      // Should mark (0,0), (1,0), (0,1), (1,1) all dirty
      expect(grid.dirtyCount).toBe(4);
    });

    it('clamps damage to grid bounds', () => {
      const grid = new TileGrid(256, 256, 'test');
      grid.clearDirtyFlags();

      // Damage extending beyond grid
      grid.addDamage(200, 200, 200, 200);
      expect(grid.dirtyCount).toBe(1); // Only 1 tile in a 1x1 grid
    });
  });

  describe('getDirtyTiles', () => {
    it('returns only dirty tiles', () => {
      const grid = new TileGrid(512, 512, 'test');
      grid.clearDirtyFlags();
      grid.addDamage(10, 10, 100, 100);
      const dirty = grid.getDirtyTiles();
      expect(dirty.length).toBe(1);
      expect(dirty[0]!.col).toBe(0);
      expect(dirty[0]!.row).toBe(0);
    });
  });

  describe('getVisibleTiles', () => {
    it('returns tiles intersecting viewport', () => {
      const grid = new TileGrid(1024, 1024, 'test');
      const visible = grid.getVisibleTiles({ x: 0, y: 0, width: 300, height: 300 });
      // Should see tiles (0,0), (1,0), (0,1), (1,1)
      expect(visible.length).toBe(4);
    });

    it('returns empty for viewport outside grid', () => {
      const grid = new TileGrid(256, 256, 'test');
      const visible = grid.getVisibleTiles({ x: 1000, y: 1000, width: 100, height: 100 });
      expect(visible.length).toBe(0);
    });
  });

  describe('flattenToBuffer', () => {
    it('returns null when no tiles have buffers', () => {
      const grid = new TileGrid(256, 256, 'test');
      expect(grid.flattenToBuffer()).toBeNull();
    });

    it('combines tile buffers into layer buffer', () => {
      const grid = new TileGrid(512, 256, 'test');

      // Manually set tile buffers
      for (const tile of grid.allTiles) {
        const buf = new Uint8ClampedArray(tile.width * tile.height * 4);
        // Fill with some color
        for (let i = 0; i < buf.length; i += 4) {
          buf[i] = 255; // R
          buf[i + 1] = 0; // G
          buf[i + 2] = 0; // B
          buf[i + 3] = 255; // A
        }
        tile.buffer = buf;
      }

      const flat = grid.flattenToBuffer();
      expect(flat).not.toBeNull();
      expect(flat!.length).toBe(512 * 256 * 4);
      // First pixel should be red
      expect(flat![0]).toBe(255);
      expect(flat![1]).toBe(0);
      expect(flat![2]).toBe(0);
      expect(flat![3]).toBe(255);
    });
  });

  describe('clearDirtyFlags', () => {
    it('clears all dirty flags', () => {
      const grid = new TileGrid(512, 512, 'test');
      grid.addDamage(0, 0, 100, 100);
      expect(grid.dirtyCount).toBeGreaterThan(0);
      grid.clearDirtyFlags();
      expect(grid.dirtyCount).toBe(0);
    });
  });

  describe('dispose', () => {
    it('clears all tile buffers', () => {
      const grid = new TileGrid(256, 256, 'test');
      grid.allTiles[0]!.buffer = new Uint8ClampedArray(256 * 256 * 4);
      grid.dispose();
      expect(grid.allTiles[0]!.buffer).toBeNull();
    });
  });
});
