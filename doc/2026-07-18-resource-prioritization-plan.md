# Resource Prioritization — Design Plan

**Date:** 2026-07-18
**Status:** Planned (not yet implemented)
**Author:** opencode

---

## Problem Statement

The current `ResourceLoader` has a FIFO concurrency queue that ignores priority. High-priority resources (stylesheets, blocking scripts) wait behind low-priority ones (images, media) that were enqueued first. Additionally:

1. **No fetchpriority support** — HTML attributes like `fetchpriority="high"` are ignored
2. **Discovered resources unused** — The HTML parser discovers resources during parsing but they're never batch-loaded
3. **No preload/prefetch/preconnect** — `<link rel="preload">` etc. are not handled
4. **CacheManager disconnected** — Exists standalone but ResourceLoader never checks it
5. **No bandwidth adaptation** — No mechanism to adjust behavior on slow connections
6. **No speculative parsing** — No look-ahead for resource hints

## Architecture

```
HTML Parser                    Resource Prioritizer
  │  discovers resources          │
  │  (scripts, styles, imgs,      │  PriorityQueue (min-heap)
  │   links, preloads, fonts)     │  ├── Blocking tier (weight 0)
  │                               │  ├── High tier (weight 1)
  ▼                               │  ├── Normal tier (weight 2)
ResourcePrioritizer               │  ├── Low tier (weight 3)
  │  merges parser hints +        │  └── Deferred tier (weight 4)
  │  fetchpriority attributes +   │
  │  cache lookups +              ├── BandwidthEstimator
  │  speculative preloads         │     └── adjusts tier thresholds
  │                               │
  ▼                               │
ResourceLoader                    │
  ├── PriorityQueue.acquire()     │  CacheManager
  │   (priority-ordered slots)    │  ├── get(url) → hit → return
  ├── CacheManager.get(url)       │  └── miss → fetch → set(url)
  │   (before network fetch)      │
  ├── IHttpClient.send()          │
  └── IConnectionPool.acquire()   │
```

## New Modules

### 1. PriorityQueue (`src/browser/netwroking/priority-queue.ts`)

Generic binary min-heap priority queue.

```typescript
class PriorityQueue<T> {
  enqueue(item: T, priority: number): void;   // O(log n)
  dequeue(): T | undefined;                    // O(log n)
  peek(): T | undefined;
  readonly size: number;
  readonly isEmpty: boolean;
  drain(): T[];
  remove(predicate: (item: T) => boolean): T[];
  clear(): void;
}
```

**Priority convention:** Lower number = higher priority (matches existing `priorityWeight()`):
- `0` = blocking (stylesheets)
- `1` = high (scripts, fonts)
- `2` = normal (images)
- `3` = low (media)
- `4` = deferred (lazy images, prefetch)

### 2. BandwidthEstimator (`src/browser/netwroking/bandwidth-estimator.ts`)

Sliding-window bandwidth tracker that adjusts scheduling.

```typescript
class BandwidthEstimator {
  record(bytes: number, durationMs: number): void;
  estimate(): number;                           // bytes/ms
  shouldDemote(tier: ResourcePriority): boolean;
  effectiveConcurrency(): number;
  reset(): void;
}
```

**Bandwidth tiers:**
| Estimate (bytes/ms) | Label | Demotions | Max Concurrency |
|---------------------|-------|-----------|-----------------|
| > 1.0 | Fast | None | 6 |
| 0.3 – 1.0 | Medium | `low`, `deferred` | 4 |
| < 0.3 | Slow | `normal`, `low`, `deferred` | 2 |

### 3. ResourcePrioritizer (`src/browser/netwroking/resource-prioritizer.ts`)

Central authority that merges all prioritization signals.

```typescript
interface ResourcePrioritizerConfig {
  maxConcurrent: number;           // default 6
  preconnectHostLimit: number;     // default 2
  preloadBudget: number;           // max concurrent preloads (default 3)
  idlePriorityBoost: boolean;      // boost deferred when idle (default true)
}

class ResourcePrioritizer {
  submit(resource: DiscoveredResource, options?: SubmitOptions): void;
  submitBatch(resources: readonly DiscoveredResource[]): void;
  submitPreload(url: string, as: string, priority: ResourcePriority): void;
  submitPrefetch(url: string): void;
  submitPreconnect(hostname: string): void;
  next(): QueuedResource | null;
  complete(resourceId: string): void;
  hasCritical(): boolean;
  stats(): PrioritizerStats;
}
```

**Priority resolution order (highest → lowest precedence):**
1. `fetchpriority="high|low"` from HTML attribute
2. `blocking` / `deferred` flags from parser
3. Resource type defaults
4. `rel="preload"` → `high`; `rel="prefetch"` → `deferred`
5. Bandwidth-based demotion

## Type Extensions

### DiscoveredResource (modified)

```typescript
// Added field:
interface DiscoveredResource {
  readonly url: string;
  readonly kind: DiscoveredResourceKind;
  readonly blocking: boolean;
  readonly deferred: boolean;
  readonly sourceTag: string;
  readonly fetchPriority?: 'high' | 'low' | 'auto';  // NEW
}
```

### DiscoveredResourceKind (extended)

```typescript
type DiscoveredResourceKind =
  | 'stylesheet' | 'script' | 'image' | 'font' | 'media' | 'document'
  | 'preload' | 'prefetch' | 'preconnect' | 'other';  // NEW kinds
```

## Modified Files

### `src/browser/rendering/html5/tree-builder.ts`

Enhanced `discoverResources()`:
- Read `fetchpriority` attribute on `<img>`, `<script>`, `<link>`
- Discover `<link rel="preload">` → kind depends on `as` attribute
- Discover `<link rel="prefetch">` → always deferred
- Discover `<link rel="preconnect">` → lightweight connection hint

### `src/browser/netwroking/resource-loader.ts`

- Replace `pendingQueue: Array<() => void>` with `PriorityQueue`
- `acquireSlot(priority)` instead of `acquireSlot()`
- Accept optional `ICacheManager` in constructor
- Check cache before `client.send()`, populate on success
- Record bandwidth samples via `BandwidthEstimator`
- Adjust `maxConcurrent` based on bandwidth

### `src/app/main.ts`

- In `createPageRenderer().render()`, feed `parseResult.resources` to `ResourcePrioritizer.submitBatch()`
- Wire ResourcePrioritizer → ResourceLoader

## Cache Integration

**Scope:** Wire `ICacheManager` into `ResourceLoader.loadResource()`.

```typescript
// In ResourceLoader.loadResource():
if (this.cache) {
  const cached = await this.cache.get(url);
  if (cached && !this.isStale(cached)) {
    return { ...cached, fromCache: true };
  }
}
// ... network fetch ...
if (this.cache && result.error === null) {
  await this.cache.set(url, { body: result.body, contentType: result.contentType, ... });
}
```

**Cache hit path:** Returns immediately, skips network.
**Cache miss path:** Fetches from network, populates cache.
**Stale entry:** Revalidates via conditional request (If-None-Match / If-Modified-Since).

## Test Plan

| Test File | Tests | Coverage |
|-----------|-------|----------|
| `priority-queue.test.ts` | 20+ | Enqueue/dequeue ordering, drain, remove, edge cases, stress |
| `bandwidth-estimator.test.ts` | 15+ | Sliding window, tier thresholds, concurrency, reset |
| `resource-prioritizer.test.ts` | 25+ | Priority resolution, fetchpriority override, preload/prefetch/preconnect, bandwidth demotion |
| `resource-loader.test.ts` | 20+ | Priority queue integration, cache hit/miss, preconnect, batch ordering |

## Implementation Order

1. `priority-queue.ts` + tests (no dependencies)
2. `bandwidth-estimator.ts` + tests (no dependencies)
3. `dom.ts` type extensions (`fetchPriority`, new kinds)
4. `tree-builder.ts` resource discovery enhancements
5. `resource-prioritizer.ts` + tests (depends on 1+2)
6. `resource-loader.ts` modifications (priority queue, cache, bandwidth)
7. `resource-loader.test.ts` integration tests
8. `main.ts` wiring

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Heap vs sorted array | Binary min-heap | O(log n) insert/extract vs O(n) |
| Cache integration layer | Direct in ResourceLoader | Keeps single responsibility; ~5 lines |
| fetchpriority semantics | Override type defaults, not blocking/deferred | Spec says hint; blocking/deferred authoritative |
| Preload budget | Hard limit 3 concurrent | Prevents preload storms |
| Bandwidth demotion | Only demote, never promote | Promoting wastes bandwidth on non-critical |
| Preconnect | DNS-only hint | Actual connection on first request |

## Estimated Scope

- **New LOC:** ~380 (4 modules)
- **Modified LOC:** ~100 (5 files)
- **New tests:** ~80 (4 test files)
- **Total effort:** ~580 LOC + ~80 tests
