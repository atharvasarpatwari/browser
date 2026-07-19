import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BandwidthEstimator } from '../src/browser/netwroking/bandwidth-estimator';

describe('BandwidthEstimator', () => {
  let est: BandwidthEstimator;

  beforeEach(() => {
    est = new BandwidthEstimator({ windowMs: 1000, maxSamples: 10 });
  });

  it('defaults to fast when no data', () => {
    expect(est.estimate()).toBe(1.0);
    expect(est.tier()).toBe('fast');
    expect(est.effectiveConcurrency()).toBe(6);
  });

  it('records and estimates bandwidth', () => {
    est.record(1000, 100); // 10 bytes/ms
    expect(est.estimate()).toBeCloseTo(10.0, 1);
    expect(est.tier()).toBe('fast');
  });

  it('medium bandwidth tier', () => {
    est.record(50, 100); // 0.5 bytes/ms
    expect(est.estimate()).toBeCloseTo(0.5, 2);
    expect(est.tier()).toBe('medium');
    expect(est.effectiveConcurrency()).toBe(4);
  });

  it('slow bandwidth tier', () => {
    est.record(10, 100); // 0.1 bytes/ms
    expect(est.estimate()).toBeCloseTo(0.1, 2);
    expect(est.tier()).toBe('slow');
    expect(est.effectiveConcurrency()).toBe(2);
  });

  it('averages multiple samples', () => {
    est.record(100, 100); // 1.0
    est.record(200, 100); // 2.0
    expect(est.estimate()).toBeCloseTo(1.5, 1);
  });

  it('prunes old samples outside window', () => {
    vi.useFakeTimers();
    est.record(100, 10); // 10 bytes/ms → fast
    vi.advanceTimersByTime(1500); // > windowMs=1000
    est.record(10, 100); // 0.1 bytes/ms → slow
    expect(est.estimate()).toBeCloseTo(0.1, 2);
    expect(est.tier()).toBe('slow');
    vi.useRealTimers();
  });

  it('prunes to maxSamples', () => {
    for (let i = 0; i < 15; i++) {
      est.record(100, 100);
    }
    expect(est.estimate()).toBeCloseTo(1.0, 1);
  });

  it('ignores zero/negative duration', () => {
    est.record(100, 0);
    est.record(100, -10);
    expect(est.estimate()).toBe(1.0); // default
  });

  it('shouldDemote fast never demotes', () => {
    est.record(1000, 100); // fast
    expect(est.shouldDemote(0)).toBe(false);
    expect(est.shouldDemote(2)).toBe(false);
    expect(est.shouldDemote(4)).toBe(false);
  });

  it('shouldDemote medium demotes low + deferred (priority >= 3)', () => {
    est.record(50, 100); // medium
    expect(est.shouldDemote(0)).toBe(false);
    expect(est.shouldDemote(1)).toBe(false);
    expect(est.shouldDemote(2)).toBe(false);
    expect(est.shouldDemote(3)).toBe(true);  // low
    expect(est.shouldDemote(4)).toBe(true);  // deferred
  });

  it('shouldDemote slow demotes normal + low + deferred (priority >= 2)', () => {
    est.record(10, 100); // slow
    expect(est.shouldDemote(0)).toBe(false);
    expect(est.shouldDemote(1)).toBe(false);
    expect(est.shouldDemote(2)).toBe(true);  // normal
    expect(est.shouldDemote(3)).toBe(true);  // low
    expect(est.shouldDemote(4)).toBe(true);  // deferred
  });

  it('reset clears all data', () => {
    est.record(10, 100); // slow
    est.reset();
    expect(est.estimate()).toBe(1.0);
    expect(est.tier()).toBe('fast');
  });

  it('concurrency tiers', () => {
    est.record(1000, 100);
    expect(est.effectiveConcurrency()).toBe(6);
    est.reset();

    est.record(50, 100);
    expect(est.effectiveConcurrency()).toBe(4);
    est.reset();

    est.record(10, 100);
    expect(est.effectiveConcurrency()).toBe(2);
  });
});
