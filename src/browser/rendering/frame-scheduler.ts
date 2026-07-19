// ─────────────────────────────────────────────────────────────────────────────
// FRAME SCHEDULER
// ─────────────────────────────────────────────────────────────────────────────

/**
 * A coalescing frame scheduler that batches multiple invalidation requests
 * into a single frame callback, analogous to `requestAnimationFrame`.
 *
 * Multiple calls to `schedule()` within the same microtask batch are
 * collapsed into a single callback invocation.  The callback receives a
 * high-resolution timestamp.
 *
 * In Node / test environments where `requestAnimationFrame` is unavailable,
 * the scheduler falls back to `setTimeout(..., 0)` wrapped in a microtask
 * to simulate frame-level batching.
 */

export type FrameCallback = (timestamp: number) => void;

export class FrameScheduler {
  private pending = false;
  private callback: FrameCallback | null = null;
  private frameCount = 0;

  /**
   * Schedule a callback for the next frame.
   *
   * If a frame is already pending the callback is *replaced* (not queued),
   * which is the correct coalescing semantics — only the latest state
   * matters.
   */
  schedule(callback: FrameCallback): void {
    this.callback = callback;
    if (!this.pending) {
      this.pending = true;
      this.requestFrame();
    }
  }

  /** Cancel a pending frame (if any). */
  cancel(): void {
    this.callback = null;
    this.pending = false;
  }

  /** Whether a frame callback is currently pending. */
  isScheduled(): boolean {
    return this.pending;
  }

  /** Total number of frames that have been dispatched. */
  getFrameCount(): number {
    return this.frameCount;
  }

  // ── Platform abstraction ──────────────────────────────────────────

  private requestFrame(): void {
    if (typeof requestAnimationFrame !== 'undefined') {
      requestAnimationFrame(() => this.flush());
    } else {
      queueMicrotask(() => this.flush());
    }
  }

  private flush(): void {
    this.pending = false;
    const cb = this.callback;
    this.callback = null;
    if (cb) {
      this.frameCount++;
      cb(typeof performance !== 'undefined' ? performance.now() : Date.now());
    }
  }

  /** Cancel any pending frame and release the callback reference. */
  dispose(): void {
    this.cancel();
  }
}
