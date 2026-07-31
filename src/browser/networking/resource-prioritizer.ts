// ─────────────────────────────────────────────────────────────────────────────
// RESOURCE PRIORITIZER — Central priority authority for resource loading
// ─────────────────────────────────────────────────────────────────────────────

import type { IDisposable } from '../../app/dependency-container';
import type { DiscoveredResource, DiscoveredResourceKind } from '../rendering/html5/dom';
import { PriorityQueue } from './priority-queue';
import { BandwidthEstimator } from './bandwidth-estimator';

type ResourcePriority = 'blocking' | 'high' | 'normal' | 'low' | 'deferred';

interface PrioritizerStats {
  readonly queued: number;
  readonly active: number;
  readonly completed: number;
  readonly blocked: number;
  readonly totalBandwidthEstimate: number;
  readonly bandwidthTier: string;
  readonly effectiveConcurrency: number;
}

interface QueuedResource {
  readonly resource: DiscoveredResource;
  readonly resolvedPriority: ResourcePriority;
  readonly weight: number;
}

class ResourcePrioritizer {
  private readonly queue = new PriorityQueue<DiscoveredResource>();
  private readonly weightMap = new Map<DiscoveredResource, number>();
  private readonly bandwidth = new BandwidthEstimator();
  private activeCount = 0;
  private completedCount = 0;
  private maxConcurrent: number;
  private readonly preconnectHosts = new Set<string>();
  private readonly preloadBudget: number;
  private activePreloads = 0;

  constructor(options?: {
    maxConcurrent?: number;
    preloadBudget?: number;
  }) {
    this.maxConcurrent = options?.maxConcurrent ?? 6;
    this.preloadBudget = options?.preloadBudget ?? 3;
  }

  submit(resource: DiscoveredResource, overridePriority?: ResourcePriority): void {
    const weight = this.resolveWeight(resource, overridePriority);
    this.weightMap.set(resource, weight);
    if (this.bandwidth.shouldDemote(weight)) {
      const demotedWeight = Math.min(weight + 1, 4);
      this.weightMap.set(resource, demotedWeight);
      this.queue.enqueue(resource, demotedWeight);
    } else {
      this.queue.enqueue(resource, weight);
    }
  }

  submitBatch(resources: readonly DiscoveredResource[]): void {
    for (const r of resources) {
      this.submit(r);
    }
  }

  submitPreload(url: string, as: string, priority: ResourcePriority): void {
    if (this.activePreloads >= this.preloadBudget) return;
    const resource: DiscoveredResource = {
      url, kind: as as DiscoveredResourceKind,
      blocking: false, deferred: false,
      sourceTag: 'link', fetchPriority: 'high',
    };
    this.submit(resource, priority);
    this.activePreloads++;
  }

  submitPrefetch(url: string): void {
    const resource: DiscoveredResource = {
      url, kind: 'prefetch',
      blocking: false, deferred: true,
      sourceTag: 'link',
    };
    this.submit(resource, 'deferred');
  }

  submitPreconnect(hostname: string): void {
    if (this.preconnectHosts.has(hostname)) return;
    this.preconnectHosts.add(hostname);
    // Preconnects are lightweight — don't go through the queue
  }

  next(): QueuedResource | null {
    const resource = this.queue.dequeue();
    if (!resource) return null;
    const weight = this.weightMap.get(resource) ?? this.resolveWeight(resource);
    this.weightMap.delete(resource);
    return {
      resource,
      resolvedPriority: this.weightToPriority(weight),
      weight,
    };
  }

  complete(resourceUrl: string): void {
    this.completedCount++;
    if (this.preconnectHosts.has(new URL(resourceUrl).hostname)) {
      // Don't remove preconnect — keep for future requests
    }
  }

  recordBandwidth(bytes: number, durationMs: number): void {
    this.bandwidth.record(bytes, durationMs);
    // Dynamically adjust concurrency based on bandwidth
    this.maxConcurrent = this.bandwidth.effectiveConcurrency();
  }

  hasCritical(): boolean {
    return this.queue.filter(r => {
      const w = this.weightMap.get(r) ?? this.resolveWeight(r);
      return w === 0;
    }).length > 0;
  }

  stats(): PrioritizerStats {
    return {
      queued: this.queue.size,
      active: this.activeCount,
      completed: this.completedCount,
      blocked: this.preconnectHosts.size,
      totalBandwidthEstimate: this.bandwidth.estimate(),
      bandwidthTier: this.bandwidth.tier(),
      effectiveConcurrency: this.maxConcurrent,
    };
  }

  peek(): QueuedResource | null {
    const resource = this.queue.peek();
    if (!resource) return null;
    const weight = this.weightMap.get(resource) ?? this.resolveWeight(resource);
    return {
      resource,
      resolvedPriority: this.weightToPriority(weight),
      weight,
    };
  }

  hasPreconnect(hostname: string): boolean {
    return this.preconnectHosts.has(hostname);
  }

  clear(): void {
    this.queue.clear();
    this.weightMap.clear();
    this.activeCount = 0;
    this.completedCount = 0;
    this.activePreloads = 0;
    this.preconnectHosts.clear();
    this.bandwidth.reset();
  }

  dispose(): void {
    this.clear();
  }

  // ── Priority resolution ────────────────────────────────────────────────────

  private resolveWeight(resource: DiscoveredResource, override?: ResourcePriority): number {
    // 1. Explicit override from caller
    if (override) return this.priorityToWeight(override);

    // 2. blocking/deferred flags (authoritative per spec)
    if (resource.blocking) return 0;
    if (resource.deferred) return 4;

    // 3. fetchpriority attribute override (hint — lower precedence than blocking/deferred)
    if (resource.fetchPriority === 'high') return 1;
    if (resource.fetchPriority === 'low') return 3;

    // 4. Resource type defaults
    return this.typeDefaultWeight(resource.kind);
  }

  private typeDefaultWeight(kind: DiscoveredResourceKind): number {
    switch (kind) {
      case 'stylesheet': return 0;
      case 'script': return 1;
      case 'font': return 1;
      case 'image': return 2;
      case 'preload': return 1;
      case 'prefetch': return 4;
      case 'preconnect': return 1;
      case 'media': return 3;
      case 'document': return 2;
      default: return 2;
    }
  }

  private priorityToWeight(p: ResourcePriority): number {
    switch (p) {
      case 'blocking': return 0;
      case 'high': return 1;
      case 'normal': return 2;
      case 'low': return 3;
      case 'deferred': return 4;
    }
  }

  private weightToPriority(w: number): ResourcePriority {
    switch (w) {
      case 0: return 'blocking';
      case 1: return 'high';
      case 2: return 'normal';
      case 3: return 'low';
      case 4: return 'deferred';
      default: return 'normal';
    }
  }
}

export { ResourcePrioritizer };
export type { ResourcePriority, PrioritizerStats, QueuedResource };
