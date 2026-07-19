# Resource Prioritization — Implementation

**Date:** 2026-07-18
**Session:** Implemented priority-aware resource loading with cache integration
**Status:** Completed

---

## Summary

Implemented the resource prioritization system as designed in `resource-prioritization-plan.md`. Four new modules, three modified files, and 69 new tests. All 2431 tests pass.

## What Was Built

### New Modules

| Module | LOC | Tests | Purpose |
|--------|-----|-------|---------|
| `priority-queue.ts` | 130 | 18 | Generic binary min-heap priority queue |
| `bandwidth-estimator.ts` | 80 | 13 | Sliding-window bandwidth tracker with tier-based scheduling |
| `resource-prioritizer.ts` | 185 | 28 | Central priority authority — merges parser hints, fetchpriority, bandwidth |
| `resource-loader.test.ts` | — | 10 | Cache integration + priority queue integration tests |

### Modified Files

| File | Changes |
|------|---------|
| `dom.ts` | Added `fetchPriority` to `DiscoveredResource`, new kinds: `preload`, `prefetch`, `preconnect` |
| `constants.ts` | Updated `LINK_REL_MAP` with `prefetch`, `preconnect` entries |
| `tree-builder.ts` | Reads `fetchpriority` attribute, discovers `<link rel="preload/prefetch/preconnect">`, `loading="lazy"` |
| `resource-loader.ts` | Priority-ordered `acquireSlot`, `ICacheManager` integration, `BandwidthEstimator` tracking |
| `main.ts` | Wired `ResourcePrioritizer` into `createPageRenderer` |

## Priority Resolution Order

1. **Explicit override** from caller (`submit(resource, 'blocking')`)
2. **blocking/deferred flags** from parser (authoritative)
3. **fetchpriority attribute** (`high` → weight 1, `low` → weight 3)
4. **Resource type defaults** (stylesheet=0, script/font=1, image=2, media=3, prefetch=4)
5. **Bandwidth demotion** (slow: demote weight≥2, medium: demote weight≥3)

## Cache Integration

- `ResourceLoader` accepts optional `ICacheManager` in constructor
- Cache checked before every network fetch
- Successful responses (2xx,3xx) cached with TTL from `cache-control: max-age`
- `immutable` and `etag`/`last-modified` preserved for revalidation
- Error responses (4xx,5xx) NOT cached

## Bandwidth Adaptation

| Tier | Threshold | Demotions | Max Concurrency |
|------|-----------|-----------|-----------------|
| Fast | ≥ 1.0 bytes/ms | None | 6 |
| Medium | ≥ 0.3 bytes/ms | low, deferred | 4 |
| Slow | < 0.3 bytes/ms | normal, low, deferred | 2 |

## Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Blocking/deferred checked before fetchpriority | Yes | Spec says blocking/deferred are authoritative; fetchpriority is a hint |
| Weight stored per resource in weightMap | Map | `next()` must return the exact weight used at submit time, not recalculate |
| Cache entry includes url field | Required by CacheEntry type | `Omit` doesn't exclude `url`; matches CacheManager.set() signature |
| PriorityQueue uses insertion order tiebreaker | FIFO within same priority | Deterministic ordering |

## Test Results

```
65 test files, 2431 tests — all passing
New tests: 69 (priority-queue: 18, bandwidth-estimator: 13, resource-prioritizer: 28, resource-loader: 10)
```

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/netwroking/priority-queue.ts` | Generic binary min-heap |
| `src/browser/netwroking/bandwidth-estimator.ts` | Sliding-window bandwidth tracker |
| `src/browser/netwroking/resource-prioritizer.ts` | Central priority authority |
| `tests/priority-queue.test.ts` | 18 tests |
| `tests/bandwidth-estimator.test.ts` | 13 tests |
| `tests/resource-prioritizer.test.ts` | 28 tests |
| `tests/resource-loader.test.ts` | 10 tests |
