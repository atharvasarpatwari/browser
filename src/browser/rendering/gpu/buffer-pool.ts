import type { GpuBufferEntry, GpuBufferStats } from './types';
import { GPU_BUFFER_ALIGNMENT, GPU_BUFFER_POOL_MAX_AGE_MS, GPU_BUFFER_POOL_MAX_IDLE } from './types';

// ─────────────────────────────────────────────────────────────────────────────
// BUFFER POOL
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Manages a pool of reusable GPU buffers.
 *
 * Responsibilities:
 * - Allocate buffers with proper alignment
 * - Reuse buffers to avoid allocation overhead
 * - Track buffer usage and reference counts
 * - Clean up idle and expired buffers
 */
export class BufferPool {
  private readonly device: GPUDevice;
  private readonly pool = new Map<number, GpuBufferEntry[]>();
  private readonly active = new Set<GpuBufferEntry>();
  private totalAllocatedBytes = 0;
  private hits = 0;
  private misses = 0;

  constructor(device: GPUDevice) {
    this.device = device;
  }

  // ── Public API ──────────────────────────────────────────────────

  /**
   * Acquire a buffer with the specified size and usage.
   * Returns a pooled buffer if available, otherwise allocates a new one.
   */
  acquire(size: number, usage: GPUBufferUsageFlags): GpuBufferEntry {
    const alignedSize = this.alignSize(size);

    // Try to find a reusable buffer in the pool
    const pooled = this.findReusable(alignedSize, usage);
    if (pooled) {
      this.hits++;
      pooled.refCount++;
      pooled.lastUsed = Date.now();
      this.active.add(pooled);
      return pooled;
    }

    // Allocate a new buffer
    this.misses++;
    const buffer = this.device.createBuffer({
      size: alignedSize,
      usage,
      mappedAtCreation: false,
    });

    const entry: GpuBufferEntry = {
      buffer,
      size: alignedSize,
      usage,
      lastUsed: Date.now(),
      refCount: 1,
    };

    this.totalAllocatedBytes += alignedSize;
    this.active.add(entry);
    return entry;
  }

  /**
   * Release a buffer back to the pool.
   */
  release(entry: GpuBufferEntry): void {
    if (entry.refCount <= 0) return;

    entry.refCount--;
    if (entry.refCount <= 0) {
      this.active.delete(entry);
      this.returnToPool(entry);
    }
  }

  /**
   * Get a staging buffer for GPU-to-CPU readback.
   * Staging buffers are always fresh (not pooled) for data integrity.
   */
  acquireStagingBuffer(size: number): GPUBuffer {
    const alignedSize = this.alignSize(size);
    return this.device.createBuffer({
      size: alignedSize,
      usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ,
      mappedAtCreation: false,
    });
  }

  /**
   * Destroy a staging buffer after use.
   */
  destroyStagingBuffer(buffer: GPUBuffer): void {
    buffer.destroy();
  }

  /**
   * Get pool statistics.
   */
  getStats(): GpuBufferStats {
    let pooledBuffers = 0;
    for (const entries of this.pool.values()) {
      pooledBuffers += entries.length;
    }

    return {
      totalBuffers: this.active.size + pooledBuffers,
      totalAllocatedBytes: this.totalAllocatedBytes,
      activeBuffers: this.active.size,
      pooledBuffers,
      hits: this.hits,
      misses: this.misses,
    };
  }

  /**
   * Clean up expired and excess idle buffers.
   */
  cleanup(): void {
    const now = Date.now();

    for (const [size, entries] of this.pool.entries()) {
      const retained: GpuBufferEntry[] = [];

      for (const entry of entries) {
        const age = now - entry.lastUsed;

        // Remove expired buffers
        if (age > GPU_BUFFER_POOL_MAX_AGE_MS) {
          this.destroyEntry(entry);
          continue;
        }

        // Keep up to MAX_IDLE buffers per size class
        if (retained.length < GPU_BUFFER_POOL_MAX_IDLE) {
          retained.push(entry);
        } else {
          this.destroyEntry(entry);
        }
      }

      if (retained.length === 0) {
        this.pool.delete(size);
      } else {
        this.pool.set(size, retained);
      }
    }
  }

  /**
   * Destroy all buffers and reset state.
   */
  dispose(): void {
    // Destroy active buffers
    for (const entry of this.active) {
      this.destroyEntry(entry);
    }
    this.active.clear();

    // Destroy pooled buffers
    for (const entries of this.pool.values()) {
      for (const entry of entries) {
        this.destroyEntry(entry);
      }
    }
    this.pool.clear();

    this.totalAllocatedBytes = 0;
    this.hits = 0;
    this.misses = 0;
  }

  // ── Private ─────────────────────────────────────────────────────

  private alignSize(size: number): number {
    return Math.ceil(size / GPU_BUFFER_ALIGNMENT) * GPU_BUFFER_ALIGNMENT;
  }

  private findReusable(size: number, usage: GPUBufferUsageFlags): GpuBufferEntry | null {
    const entries = this.pool.get(size);
    if (!entries || entries.length === 0) return null;

    // Find a buffer with compatible usage
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (this.isUsageCompatible(entry.usage, usage)) {
        entries.splice(i, 1);
        return entry;
      }
    }

    return null;
  }

  private isUsageCompatible(existing: GPUBufferUsageFlags, required: GPUBufferUsageFlags): boolean {
    // A buffer is reusable if it has all the required usage flags
    return (existing & required) === required;
  }

  private returnToPool(entry: GpuBufferEntry): void {
    entry.lastUsed = Date.now();
    entry.refCount = 0;

    const sizeEntries = this.pool.get(entry.size) ?? [];
    if (sizeEntries.length < GPU_BUFFER_POOL_MAX_IDLE) {
      sizeEntries.push(entry);
      this.pool.set(entry.size, sizeEntries);
    } else {
      this.destroyEntry(entry);
    }
  }

  private destroyEntry(entry: GpuBufferEntry): void {
    entry.buffer.destroy();
    this.totalAllocatedBytes -= entry.size;
  }
}
