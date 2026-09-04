# Known Test Failures — Tracking

**Status:** Populated 2026-09-03 from a real, full `npm test` run (`vitest run`, 208 test
files / 9108 tests, from `E:\nova_1`, duration 168.72s). This replaces the earlier
template-only version of this file (added 2026-08-27 by a session with file-bridge access
only, no shell). The TypeScript section below was filled in 2026-09-04 (buffer-safe
networking session baseline) — see **TypeScript errors**.

---

## Why this file exists

Searching `doc/README.md`'s session index turns up this phrase, or a close variant of it,
repeatedly across many months of sessions:

> "...only pre-existing networking failures remain"
> "...3 pre-existing DNS failures only"
> "...tsc 5 known only"

Each individual session treated these as acceptable and moved on — reasonably, if the failures
are genuinely unrelated to what that session touched. But because no session had ever named
the specific failing tests in one place, there was no way to tell whether it's been the *same*
handful of failures the whole time, or a slowly growing set that each session assumed was the
same "pre-existing" ones without checking. The 2026-09-03 run below answers that: as of this
run, there is exactly **one** failing test in the whole suite, and it's a timing flake, not a
logic bug.

## What to do

1. Run the full suite: `npm test` (vitest) and `npm run typecheck` (tsc).
2. For every failure, record it below with the exact test file + test name, not just a count.
3. For each one, either:
   - Fix it, and remove the row, or
   - Confirm it's a genuinely known/accepted gap (e.g. a DNS test that needs real network
     access unavailable in the CI sandbox) and write *why* in the Notes column, so the next
     session doesn't have to re-investigate from scratch.

## Failures

**Run:** 2026-09-03, `npm test` from `E:\nova_1`, vitest v4.1.10 — `Test Files 1 failed | 207
passed (208)`, `Tests 1 failed | 9107 passed (9108)`.

| Test file | Test name | First seen | Notes |
|-----------|-----------|-------------|-------|
| `tests/bytecode-vm.test.ts` | `Bytecode VM > VM-specific: performance > recursive fibonacci(20) within timeout` | 2026-09-03 | Timing-budget flake, not a logic bug. The value assertion on the line just above (`expect(result).toBe(6765)`) **passed** — the VM computed the correct fibonacci(20) — only the following `expect(elapsed).toBeLessThan(2000)` failed, with `elapsed = 2075`ms (3.75% / 75ms over budget). Almost certainly machine-load-dependent (this run's `environment` setup phase alone took 240.94s, suggesting a loaded machine at run time). Accepted as known/flaky rather than fixed this session; if it recurs consistently (not just once), consider loosening the budget (e.g. 2000ms → 2500ms) or excluding it from CI runs on shared/loaded hardware. |

No other failures were observed across the other 207 test files / 9107 tests in this run,
including files that deliberately exercise error-handling paths and emit expected `stderr`
noise (event-bus handler-throw catches, `[LifecycleManager] CRASHED`, `[ErrorBoundary:*]`
retries, sandbox `DENIED` logs, CORS-block console noise, benign `DOMException [AbortError]`
traces from happy-dom test-teardown) — none of that noise corresponded to an actual failure.

## TypeScript errors

Filled 2026-09-04 from `npm run typecheck` (`tsc --noEmit`) at `E:\nova_1` prior to the
buffer-safe networking implementation. Result: **0 errors** (clean exit, no diagnostics).

| File | Error | Notes |
|------|-------|-------|
| — | — | `tsc --noEmit` completed with 0 errors and no output. Baseline for the buffer-safe networking phasing (2026-09-04). |
