// ─────────────────────────────────────────────────────────────────────────────
// BENCHMARK RUNNER — Core infrastructure
// ─────────────────────────────────────────────────────────────────────────────

export interface BenchmarkResult {
  readonly name: string;
  readonly iterations: number;
  readonly warmup: number;
  readonly times: readonly number[];
  readonly opsPerSec: number;
  readonly meanMs: number;
  readonly medianMs: number;
  readonly p95Ms: number;
  readonly p99Ms: number;
  readonly minMs: number;
  readonly maxMs: number;
  readonly stdDevMs: number;
  readonly heapBefore: number;
  readonly heapAfter: number;
  readonly heapDelta: number;
}

export interface BenchmarkOptions {
  /** Number of warmup iterations (discarded). Default: 100 */
  readonly warmup?: number;
  /** Number of measured iterations. Default: 1000 */
  readonly iterations?: number;
  /** If true, run GC-style heap snapshot before/after. Default: true */
  readonly measureHeap?: boolean;
  /** Optional setup function called once before warmup. */
  readonly setup?: () => void;
  /** Optional teardown function called once after all iterations. */
  readonly teardown?: () => void;
}

export interface SuiteResult {
  readonly name: string;
  readonly benchmarks: readonly BenchmarkResult[];
  readonly totalMs: number;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function median(sorted: number[]): number {
  const mid = sorted.length >> 1;
  return sorted.length % 2 !== 0
    ? sorted[mid]!
    : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function percentile(sorted: number[], p: number): number {
  const idx = Math.ceil(sorted.length * p) - 1;
  return sorted[Math.max(0, idx)]!;
}

function mean(values: number[]): number {
  let sum = 0;
  for (let i = 0; i < values.length; i++) sum += values[i]!;
  return sum / values.length;
}

function stdDev(values: number[], avg: number): number {
  let sumSq = 0;
  for (let i = 0; i < values.length; i++) {
    const d = values[i]! - avg;
    sumSq += d * d;
  }
  return Math.sqrt(sumSq / values.length);
}

function getHeapUsed(): number {
  if (typeof globalThis !== 'undefined' && (globalThis as any).performance?.memory) {
    return (globalThis as any).performance.memory.usedJSHeapSize;
  }
  if (typeof process !== 'undefined' && process.memoryUsage) {
    return process.memoryUsage().heapUsed;
  }
  return 0;
}

// ─── Core runner ────────────────────────────────────────────────────────────

export function bench(
  name: string,
  fn: () => void,
  options?: BenchmarkOptions,
): BenchmarkResult {
  const warmup = options?.warmup ?? 100;
  const iterations = options?.iterations ?? 1000;
  const measureHeap = options?.measureHeap ?? true;

  if (options?.setup) options.setup();

  // Force GC hint if available
  if (typeof globalThis !== 'undefined' && (globalThis as any).gc) {
    (globalThis as any).gc();
  }

  const heapBefore = measureHeap ? getHeapUsed() : 0;

  // Warmup
  for (let i = 0; i < warmup; i++) {
    fn();
  }

  // Measured iterations
  const times: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    times[i] = performance.now() - start;
  }

  const heapAfter = measureHeap ? getHeapUsed() : 0;

  if (options?.teardown) options.teardown();

  // Sort for percentile calculations
  const sorted = [...times].sort((a, b) => a - b);
  const avg = mean(times);

  return {
    name,
    iterations,
    warmup,
    times,
    opsPerSec: avg > 0 ? 1000 / avg : Infinity,
    meanMs: avg,
    medianMs: median(sorted),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
    stdDevMs: stdDev(times, avg),
    heapBefore,
    heapAfter,
    heapDelta: heapAfter - heapBefore,
  };
}

/** Run a named suite of benchmarks. */
export function suite(
  name: string,
  benchmarks: (() => BenchmarkResult)[],
): SuiteResult {
  const start = performance.now();
  const results = benchmarks.map(b => b());
  const totalMs = performance.now() - start;
  return { name, benchmarks: results, totalMs };
}

// ─── Async runner ───────────────────────────────────────────────────────────

export interface AsyncBenchmarkOptions extends BenchmarkOptions {
  readonly warmup?: number;
  readonly iterations?: number;
}

export async function benchAsync(
  name: string,
  fn: () => Promise<void>,
  options?: AsyncBenchmarkOptions,
): Promise<BenchmarkResult> {
  const warmup = options?.warmup ?? 50;
  const iterations = options?.iterations ?? 200;
  const measureHeap = options?.measureHeap ?? true;

  if (options?.setup) options.setup();

  const heapBefore = measureHeap ? getHeapUsed() : 0;

  // Warmup
  for (let i = 0; i < warmup; i++) {
    await fn();
  }

  // Measured iterations
  const times: number[] = new Array(iterations);
  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    await fn();
    times[i] = performance.now() - start;
  }

  const heapAfter = measureHeap ? getHeapUsed() : 0;

  if (options?.teardown) options.teardown();

  const sorted = [...times].sort((a, b) => a - b);
  const avg = mean(times);

  return {
    name,
    iterations,
    warmup,
    times,
    opsPerSec: avg > 0 ? 1000 / avg : Infinity,
    meanMs: avg,
    medianMs: median(sorted),
    p95Ms: percentile(sorted, 0.95),
    p99Ms: percentile(sorted, 0.99),
    minMs: sorted[0]!,
    maxMs: sorted[sorted.length - 1]!,
    stdDevMs: stdDev(times, avg),
    heapBefore,
    heapAfter,
    heapDelta: heapAfter - heapBefore,
  };
}
