import { describe, it, expect, beforeEach } from 'vitest';
import { BandwidthEstimator } from '../src/browser/netwroking/bandwidth-estimator';

describe('BandwidthEstimator', () => {
  let estimator: BandwidthEstimator;

  beforeEach(() => {
    estimator = new BandwidthEstimator({ windowMs: 10_000, maxSamples: 20 });
  });

  // ── Basic estimation ────────────────────────────────────────────────────────

  it('should return default 1.0 when no samples', () => {
    expect(estimator.estimate()).toBe(1.0);
  });

  it('should calculate bandwidth from samples', () => {
    estimator.record(1000, 100); // 10 bytes/ms
    estimator.record(2000, 100); // 20 bytes/ms
    const bps = estimator.estimate();
    expect(bps).toBe(15); // (1000+2000)/(100+100) = 15
  });

  it('should ignore samples with 0 duration', () => {
    estimator.record(1000, 0);
    expect(estimator.estimate()).toBe(1.0);
  });

  it('should ignore negative duration', () => {
    estimator.record(1000, -5);
    expect(estimator.estimate()).toBe(1.0);
  });

  // ── Tier ────────────────────────────────────────────────────────────────────

  describe('tier', () => {
    it('should return fast for high bandwidth', () => {
      estimator.record(10000, 100); // 100 bytes/ms = fast
      expect(estimator.tier()).toBe('fast');
    });

    it('should return medium for moderate bandwidth', () => {
      estimator.record(500, 1000); // 0.5 bytes/ms = medium
      expect(estimator.tier()).toBe('medium');
    });

    it('should return slow for low bandwidth', () => {
      estimator.record(100, 1000); // 0.1 bytes/ms = slow
      expect(estimator.tier()).toBe('slow');
    });
  });

  // ── shouldDemote ────────────────────────────────────────────────────────────

  describe('shouldDemote', () => {
    it('should not demote when fast', () => {
      estimator.record(10000, 100);
      expect(estimator.shouldDemote(1)).toBe(false);
      expect(estimator.shouldDemote(3)).toBe(false);
    });

    it('should demote low+deferred when medium', () => {
      estimator.record(500, 1000);
      expect(estimator.shouldDemote(1)).toBe(false); // high
      expect(estimator.shouldDemote(2)).toBe(false); // normal
      expect(estimator.shouldDemote(3)).toBe(true);  // low
      expect(estimator.shouldDemote(4)).toBe(true);  // deferred
    });

    it('should demote normal+low+deferred when slow', () => {
      estimator.record(100, 1000);
      expect(estimator.shouldDemote(1)).toBe(false); // high
      expect(estimator.shouldDemote(2)).toBe(true);  // normal
      expect(estimator.shouldDemote(3)).toBe(true);  // low
      expect(estimator.shouldDemote(4)).toBe(true);  // deferred
    });
  });

  // ── effectiveConcurrency ────────────────────────────────────────────────────

  describe('effectiveConcurrency', () => {
    it('should return 6 for fast', () => {
      estimator.record(10000, 100);
      expect(estimator.effectiveConcurrency()).toBe(6);
    });

    it('should return 4 for medium', () => {
      estimator.record(500, 1000);
      expect(estimator.effectiveConcurrency()).toBe(4);
    });

    it('should return 2 for slow', () => {
      estimator.record(100, 1000);
      expect(estimator.effectiveConcurrency()).toBe(2);
    });
  });

  // ── reset ───────────────────────────────────────────────────────────────────

  describe('reset', () => {
    it('should clear all samples', () => {
      estimator.record(1000, 100);
      estimator.record(2000, 100);
      estimator.reset();
      expect(estimator.estimate()).toBe(1.0);
    });
  });

  // ── Pruning ─────────────────────────────────────────────────────────────────

  describe('pruning', () => {
    it('should prune old samples outside window', async () => {
      const shortWindow = new BandwidthEstimator({ windowMs: 50, maxSamples: 100 });
      shortWindow.record(1000, 10);
      // Wait for window to expire
      await new Promise(r => setTimeout(r, 100));
      shortWindow.record(100, 10);
      // Old sample should be pruned
      const bps = shortWindow.estimate();
      expect(bps).toBe(10); // only the new sample
    });

    it('should enforce maxSamples limit', () => {
      const limited = new BandwidthEstimator({ windowMs: 60_000, maxSamples: 3 });
      limited.record(100, 10);
      limited.record(200, 10);
      limited.record(300, 10);
      limited.record(400, 10);
      // Should only keep the last 3
      const bps = limited.estimate();
      // 200+300+400 / 30 = 900/30 = 30
      expect(bps).toBeCloseTo(30, 0);
    });
  });

  // ── Multiple samples ────────────────────────────────────────────────────────

  it('should average across multiple samples', () => {
    estimator.record(1000, 100); // 10 bytes/ms
    estimator.record(1000, 100); // 10 bytes/ms
    expect(estimator.estimate()).toBe(10);
  });
});
