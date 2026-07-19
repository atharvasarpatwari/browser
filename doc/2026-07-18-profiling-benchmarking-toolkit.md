# Profiling & Benchmarking Toolkit

**Date:** 2026-07-18
**Session:** Built profiling/benchmarking toolkit for all engine subsystems
**Status:** Completed

---

## Summary

Implemented a comprehensive benchmarking and profiling toolkit covering HTML/CSS parsing, layout, JS engine (lexer/parser/interpreter), paint engine, rasterizer, end-to-end pipeline, and memory leak detection. The toolkit produces both console output and Markdown reports.

## Architecture

### Core Infrastructure

| Module | Purpose |
|--------|---------|
| `src/benchmark/runner.ts` | `bench()`, `suite()`, `benchAsync()` — warmup/iterations/percentiles/heap measurement |
| `src/benchmark/reporter.ts` | `printBenchmarkResult()`, `printSuiteResult()`, `printSummary()`, `toMarkdown()` |
| `src/benchmark/profiler.ts` | `detectLeak()`, `measureAllocation()`, `takeSnapshot()`, `compareSnapshots()` |
| `src/benchmark/run.ts` | Main entry point — runs all suites + leak detection + writes Markdown report |

### Benchmark Suites

| Suite | Benchmarks | What it measures |
|-------|-----------|------------------|
| `suites/html-css.ts` | 7 | HTML parsing (tiny→large), CSS parsing, CSS tokenization |
| `suites/layout.ts` | 6 | Layout engine with varied DOM structures (paragraphs, nested, table-like, floats, styled) |
| `suites/js-engine.ts` | 12 | JS lexer, parser, interpreter (trivial→complex programs) |
| `suites/paint-raster.ts` | 11 | Stacking context, paint engine, rasterizer (100×100 → 1920×1080) |
| `suites/pipeline.ts` | 8 | End-to-end pipeline (simple→large), step-by-step breakdown |
| `suites/memory.ts` | 4 | Memory allocation per operation for HTML, layout, paint, JS |

**Total: 51 benchmarks**

### Memory Profiling

`detectLeak(name, fn, options)`:
- Runs `fn` N iterations with heap snapshots before/after
- Reports heap delta and whether it exceeds the threshold
- Used for leak detection on all major subsystems

`measureAllocation(fn, iterations)`:
- Returns average bytes allocated per call
- Useful for per-operation memory profiling

### Key Benchmark Results (2026-07-18)

| Subsystem | Best Throughput | Median Latency |
|-----------|----------------|----------------|
| HTML parse (tiny) | 17K ops/s | 0.058ms |
| HTML parse (3000 elements) | 11 ops/s | 92ms |
| CSS parse (500 rules) | 108 ops/s | 9.3ms |
| JS parse (trivial) | 528K ops/s | 0.002ms |
| JS eval (trivial) | 149K ops/s | 0.007ms |
| Layout (1 paragraph) | 56K ops/s | 0.018ms |
| Paint (simple) | 163K ops/s | 0.006ms |
| Rasterize (1920×1080, 500 cmds) | 63 ops/s | 16ms |
| Pipeline (200 items) | 23 ops/s | 43ms |

## Running

```bash
npm run benchmark        # Full suite + leak detection + Markdown report
npx tsx src/benchmark/run.ts  # Same via tsx directly
```

Output:
- Console: formatted tables with ops/s, mean, median, P95, P99, min, max, std dev
- `doc/benchmark-YYYY-MM-DD.md`: Markdown report for historical comparison

## Files Created

| File | Purpose |
|------|---------|
| `src/benchmark/runner.ts` | Core bench/suite/benchAsync infrastructure |
| `src/benchmark/reporter.ts` | Console + Markdown output formatting |
| `src/benchmark/profiler.ts` | Memory profiling utilities |
| `src/benchmark/run.ts` | Main entry point |
| `src/benchmark/suites/index.ts` | Suite re-exports |
| `src/benchmark/suites/html-css.ts` | HTML/CSS parsing benchmarks |
| `src/benchmark/suites/layout.ts` | Layout engine benchmarks |
| `src/benchmark/suites/js-engine.ts` | JS engine benchmarks |
| `src/benchmark/suites/paint-raster.ts` | Paint/rasterizer benchmarks |
| `src/benchmark/suites/pipeline.ts` | End-to-end pipeline benchmarks |
| `src/benchmark/suites/memory.ts` | Memory profiling benchmarks |

## Files Modified

| File | Change |
|------|--------|
| `package.json` | Added `benchmark` script |
| `src/browser/rendering/formatting/stacking.ts` | Added null guard in `classifyChildrenIntoContext` |

## Test Results

```
61 test files, 2362 tests — all passing
```
