import { describe, it, expect } from 'vitest';
import { ResourcePrioritizer } from '../src/browser/netwroking/resource-prioritizer';
import type { DiscoveredResource } from '../src/browser/rendering/html5/dom';

function res(overrides: Partial<DiscoveredResource> & { url: string }): DiscoveredResource {
  return {
    kind: 'image',
    blocking: false,
    deferred: false,
    sourceTag: 'img',
    ...overrides,
  };
}

describe('ResourcePrioritizer', () => {
  it('starts empty', () => {
    const p = new ResourcePrioritizer();
    expect(p.stats().queued).toBe(0);
    expect(p.next()).toBeNull();
  });

  it('resolves stylesheet to blocking (weight 0)', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'a.css', kind: 'stylesheet' }));
    const q = p.next()!;
    expect(q.resource.url).toBe('a.css');
    expect(q.resolvedPriority).toBe('blocking');
    expect(q.weight).toBe(0);
  });

  it('resolves script to high (weight 1)', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'a.js', kind: 'script' }));
    const q = p.next()!;
    expect(q.resolvedPriority).toBe('high');
  });

  it('resolves image to normal (weight 2)', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'img.png', kind: 'image' }));
    const q = p.next()!;
    expect(q.resolvedPriority).toBe('normal');
  });

  it('resolves media to low (weight 3)', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'v.mp4', kind: 'media' }));
    const q = p.next()!;
    expect(q.resolvedPriority).toBe('low');
  });

  it('ordering: blocking < high < normal < low < deferred', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'deferred', deferred: true }));
    p.submit(res({ url: 'low', kind: 'media' }));
    p.submit(res({ url: 'normal', kind: 'image' }));
    p.submit(res({ url: 'high', kind: 'script' }));
    p.submit(res({ url: 'blocking', kind: 'stylesheet' }));

    const order = [];
    let q;
    while ((q = p.next()) !== null) {
      order.push(q.resource.url);
    }
    expect(order).toEqual(['blocking', 'high', 'normal', 'low', 'deferred']);
  });

  it('fetchpriority="high" boosts image to high', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'hero.png', kind: 'image', fetchPriority: 'high' }));
    const q = p.next()!;
    expect(q.resolvedPriority).toBe('high');
    expect(q.weight).toBe(1);
  });

  it('fetchpriority="low" demotes script to low', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'a.js', kind: 'script', fetchPriority: 'low' }));
    const q = p.next()!;
    expect(q.resolvedPriority).toBe('low');
    expect(q.weight).toBe(3);
  });

  it('blocking flag overrides everything', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'a.js', kind: 'script', blocking: true, fetchPriority: 'low' }));
    const q = p.next()!;
    expect(q.weight).toBe(0);
    expect(q.resolvedPriority).toBe('blocking');
  });

  it('deferred flag sets weight 4', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'lazy.png', kind: 'image', deferred: true }));
    const q = p.next()!;
    expect(q.weight).toBe(4);
    expect(q.resolvedPriority).toBe('deferred');
  });

  it('submitBatch orders all resources', () => {
    const p = new ResourcePrioritizer();
    p.submitBatch([
      res({ url: 'lazy', deferred: true }),
      res({ url: 'style', kind: 'stylesheet' }),
      res({ url: 'img', kind: 'image' }),
      res({ url: 'script', kind: 'script' }),
    ]);
    const order = [];
    let q;
    while ((q = p.next()) !== null) order.push(q.resource.url);
    expect(order).toEqual(['style', 'script', 'img', 'lazy']);
  });

  it('submitPreload adds with high priority', () => {
    const p = new ResourcePrioritizer();
    p.submitPreload('font.woff', 'font', 'high');
    const q = p.next()!;
    expect(q.resource.url).toBe('font.woff');
    expect(q.resolvedPriority).toBe('high');
  });

  it('submitPreload respects budget', () => {
    const p = new ResourcePrioritizer({ preloadBudget: 2 });
    p.submitPreload('a.woff', 'font', 'high');
    p.submitPreload('b.woff', 'font', 'high');
    p.submitPreload('c.woff', 'font', 'high'); // exceeds budget
    expect(p.stats().queued).toBe(2);
  });

  it('submitPrefetch adds as deferred', () => {
    const p = new ResourcePrioritizer();
    p.submitPrefetch('next-page.html');
    const q = p.next()!;
    expect(q.resolvedPriority).toBe('deferred');
  });

  it('submitPreconnect tracks host', () => {
    const p = new ResourcePrioritizer();
    p.submitPreconnect('cdn.example.com');
    expect(p.hasPreconnect('cdn.example.com')).toBe(true);
    expect(p.hasPreconnect('other.com')).toBe(false);
    // Preconnects don't go through queue
    expect(p.stats().queued).toBe(0);
    expect(p.stats().blocked).toBe(1);
  });

  it('submitPreconnect deduplicates', () => {
    const p = new ResourcePrioritizer();
    p.submitPreconnect('cdn.example.com');
    p.submitPreconnect('cdn.example.com');
    expect(p.stats().blocked).toBe(1);
  });

  it('bandwidth demotion on slow connection', () => {
    const p = new ResourcePrioritizer();
    // Simulate slow bandwidth
    p.recordBandwidth(10, 100); // 0.1 bytes/ms → slow
    // Normal image should be demoted on slow connection
    p.submit(res({ url: 'img.png', kind: 'image' }));
    const q = p.next()!;
    // slow: demotes priority >= 2 (normal=2 → demoted to weight 3=low)
    expect(q.weight).toBeGreaterThanOrEqual(3);
  });

  it('bandwidth does not demote blocking/high', () => {
    const p = new ResourcePrioritizer();
    p.recordBandwidth(10, 100); // slow
    p.submit(res({ url: 'style.css', kind: 'stylesheet' })); // weight 0
    p.submit(res({ url: 'script.js', kind: 'script' })); // weight 1
    const q1 = p.next()!;
    const q2 = p.next()!;
    expect(q1.weight).toBe(0);
    expect(q2.weight).toBe(1);
  });

  it('recordBandwidth adjusts effective concurrency', () => {
    const p = new ResourcePrioritizer();
    expect(p.stats().effectiveConcurrency).toBe(6);
    p.recordBandwidth(50, 100); // medium → 4
    expect(p.stats().effectiveConcurrency).toBe(4);
    p.clear();
    p.recordBandwidth(10, 100); // slow → 2
    expect(p.stats().effectiveConcurrency).toBe(2);
  });

  it('hasCritical returns true when blocking items queued', () => {
    const p = new ResourcePrioritizer();
    expect(p.hasCritical()).toBe(false);
    p.submit(res({ url: 'img.png', kind: 'image' }));
    expect(p.hasCritical()).toBe(false);
    p.submit(res({ url: 'style.css', kind: 'stylesheet' }));
    expect(p.hasCritical()).toBe(true);
  });

  it('peek without dequeue', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'a.css', kind: 'stylesheet' }));
    expect(p.peek()!.resource.url).toBe('a.css');
    expect(p.stats().queued).toBe(1); // still in queue
  });

  it('clear resets everything', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'a.css', kind: 'stylesheet' }));
    p.submitPreconnect('cdn.com');
    p.clear();
    expect(p.stats().queued).toBe(0);
    expect(p.stats().blocked).toBe(0);
    expect(p.next()).toBeNull();
  });

  it('complete increments counter', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'a.png', kind: 'image' }));
    p.next();
    p.complete('https://example.com/a.png');
    expect(p.stats().completed).toBe(1);
  });

  it('override priority parameter', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'img.png', kind: 'image' }), 'blocking');
    const q = p.next()!;
    expect(q.weight).toBe(0);
    expect(q.resolvedPriority).toBe('blocking');
  });

  it('font defaults to high', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'font.woff', kind: 'font' }));
    const q = p.next()!;
    expect(q.resolvedPriority).toBe('high');
  });

  it('prefetch defaults to deferred', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'next.html', kind: 'prefetch' }));
    const q = p.next()!;
    expect(q.resolvedPriority).toBe('deferred');
  });

  it('preconnect defaults to high', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'https://cdn.com', kind: 'preconnect' }));
    const q = p.next()!;
    expect(q.resolvedPriority).toBe('high');
  });

  it('dispose clears everything', () => {
    const p = new ResourcePrioritizer();
    p.submit(res({ url: 'a.css', kind: 'stylesheet' }));
    p.dispose();
    expect(p.stats().queued).toBe(0);
  });
});
