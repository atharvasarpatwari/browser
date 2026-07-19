// ─────────────────────────────────────────────────────────────────────────────
// MEMORY PROFILER — Heap snapshot and leak detection utilities
// ─────────────────────────────────────────────────────────────────────────────

export interface HeapSnapshot {
  readonly timestamp: number;
  readonly heapUsed: number;
  readonly heapTotal: number;
  readonly external: number;
  readonly arrayBuffers: number;
}

export interface LeakTestResult {
  readonly name: string;
  readonly before: HeapSnapshot;
  readonly after: HeapSnapshot;
  readonly heapDelta: number;
  readonly leaked: boolean;
  readonly threshold: number;
}

function takeSnapshot(): HeapSnapshot {
  if (typeof process !== 'undefined' && process.memoryUsage) {
    const m = process.memoryUsage();
    return {
      timestamp: Date.now(),
      heapUsed: m.heapUsed,
      heapTotal: m.heapTotal,
      external: m.external,
      arrayBuffers: m.arrayBuffers,
    };
  }
  return { timestamp: Date.now(), heapUsed: 0, heapTotal: 0, external: 0, arrayBuffers: 0 };
}

/**
 * Run a function repeatedly and check if heap grows unboundedly.
 *
 * @param name - Test name
 * @param fn - Function to test (called `iterations` times)
 * @param options - Configuration
 */
export function detectLeak(
  name: string,
  fn: () => void,
  options?: {
    iterations?: number;
    /** Bytes threshold for considering it a leak. Default: 1MB */
    threshold?: number;
    /** Force GC between measurements. Default: true */
    forceGC?: boolean;
  },
): LeakTestResult {
  const iterations = options?.iterations ?? 10000;
  const threshold = options?.threshold ?? 1024 * 1024; // 1MB
  const forceGC = options?.forceGC ?? true;

  // Force GC if available
  if (forceGC && typeof globalThis !== 'undefined' && (globalThis as any).gc) {
    (globalThis as any).gc();
  }

  const before = takeSnapshot();

  for (let i = 0; i < iterations; i++) {
    fn();
  }

  // Force GC if available
  if (forceGC && typeof globalThis !== 'undefined' && (globalThis as any).gc) {
    (globalThis as any).gc();
  }

  const after = takeSnapshot();

  return {
    name,
    before,
    after,
    heapDelta: after.heapUsed - before.heapUsed,
    leaked: (after.heapUsed - before.heapUsed) > threshold,
    threshold,
  };
}

/**
 * Run a function `iterations` times and measure memory growth per iteration.
 * Returns the average bytes allocated per call.
 */
export function measureAllocation(
  fn: () => void,
  iterations = 10000,
): { bytesPerCall: number; totalAllocated: number } {
  if (typeof globalThis !== 'undefined' && (globalThis as any).gc) {
    (globalThis as any).gc();
  }

  const before = takeSnapshot();

  for (let i = 0; i < iterations; i++) {
    fn();
  }

  if (typeof globalThis !== 'undefined' && (globalThis as any).gc) {
    (globalThis as any).gc();
  }

  const after = takeSnapshot();
  const totalAllocated = after.heapUsed - before.heapUsed;

  return {
    bytesPerCall: totalAllocated / iterations,
    totalAllocated,
  };
}

/**
 * Compare two heap snapshots and return a summary.
 */
export function compareSnapshots(
  before: HeapSnapshot,
  after: HeapSnapshot,
): {
  heapDelta: number;
  heapDeltaPercent: number;
  externalDelta: number;
  arrayBuffersDelta: number;
} {
  return {
    heapDelta: after.heapUsed - before.heapUsed,
    heapDeltaPercent: before.heapUsed > 0
      ? ((after.heapUsed - before.heapUsed) / before.heapUsed) * 100
      : 0,
    externalDelta: after.external - before.external,
    arrayBuffersDelta: after.arrayBuffers - before.arrayBuffers,
  };
}

export { takeSnapshot };
