// ─────────────────────────────────────────────────────────────────────────────
// BANDWIDTH ESTIMATOR — Sliding-window bandwidth tracker
// ─────────────────────────────────────────────────────────────────────────────

type BandwidthTier = 'fast' | 'medium' | 'slow';

interface BandwidthSample {
  readonly bytes: number;
  readonly durationMs: number;
  readonly timestamp: number;
}

class BandwidthEstimator {
  private samples: BandwidthSample[] = [];
  private readonly windowMs: number;
  private readonly maxSamples: number;

  constructor(options?: { windowMs?: number; maxSamples?: number }) {
    this.windowMs = options?.windowMs ?? 10_000; // 10s sliding window
    this.maxSamples = options?.maxSamples ?? 20;
  }

  record(bytes: number, durationMs: number): void {
    if (durationMs <= 0) return;
    this.samples.push({ bytes, durationMs, timestamp: Date.now() });
    this.prune();
  }

  estimate(): number {
    this.prune();
    if (this.samples.length === 0) return 1.0; // assume fast when no data
    let totalBytes = 0;
    let totalMs = 0;
    for (const s of this.samples) {
      totalBytes += s.bytes;
      totalMs += s.durationMs;
    }
    return totalMs > 0 ? totalBytes / totalMs : 1.0;
  }

  tier(): BandwidthTier {
    const bps = this.estimate();
    if (bps >= 1.0) return 'fast';
    if (bps >= 0.3) return 'medium';
    return 'slow';
  }

  shouldDemote(priority: number): boolean {
    const t = this.tier();
    if (t === 'fast') return false;
    if (t === 'medium') return priority >= 3; // demote low + deferred
    // slow: demote normal + low + deferred
    return priority >= 2;
  }

  effectiveConcurrency(): number {
    const t = this.tier();
    switch (t) {
      case 'fast': return 6;
      case 'medium': return 4;
      case 'slow': return 2;
    }
  }

  reset(): void {
    this.samples.length = 0;
  }

  private prune(): void {
    const now = Date.now();
    while (this.samples.length > 0 && now - this.samples[0]!.timestamp > this.windowMs) {
      this.samples.shift();
    }
    while (this.samples.length > this.maxSamples) {
      this.samples.shift();
    }
  }
}

export { BandwidthEstimator };
export type { BandwidthTier, BandwidthSample };
