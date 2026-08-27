# Crash Isolation — Minimal-First Scoping

**Status:** Planned — scoping only, no implementation yet
**Related:** `process-model-design-report.md` (2026-07-21), TODO.md Priority: Medium #4

---

## Why this doc exists

TODO.md has carried "Multi-Process (Phase 2, parked)" for a while, framed as a large lift —
per-tab/per-domain process models, OS-level isolation. That's the right end state, but it's
too big to just pick up. This doc scopes the smallest version that would actually change
what happens when a tab misbehaves, so the next session can start from a concrete first step
instead of the full Phase 2 scope.

## What actually happens today

Both shells run a single content process per window, not one per tab:

- **Desktop (Electron):** `electron/main.cjs` creates exactly one `BrowserWindow` with one
  `WebContents`. That renderer hosts the whole Nova engine — parser, layout, paint, and every
  open tab's JS execution — as one page. `render-process-gone` is already handled (reloads the
  whole window), but that's a *renderer-process* crash, i.e. Chromium's own renderer dying —
  not a Nova *tab* crash. A JS exception inside one Nova tab's page script, if it escapes
  Nova's own JS-VM error handling, runs inside the same renderer as every other tab.
- **Android:** the same shape — `EngineWebView` is described elsewhere in this repo as a
  "single engine-owned WebView," with Nova's own tab model living inside it, not one
  `WebView`/`WebContents` per tab.

So "crash isolation" here doesn't map cleanly onto "give each tab its own OS process" the way
Chrome's architecture does, because tabs were never separate processes (or even separate
`WebContents`/`WebView` instances) to begin with. The real question is narrower: **does a
fault in one tab's JS execution stay contained to that tab, or can it take down the whole
window?**

## What to check before scoping anything bigger

TODO.md's own "Done" list already includes **"Crash recovery / isolation — 6 modules, 88
tests"** and item #4 explicitly says to "activate the `child_process.fork()` transport in
`ProcessManager`" — implying a process-model module already exists with a fork-based
transport that isn't turned on. Before designing new isolation work:

1. Locate `ProcessManager` and the existing crash-recovery modules (see
   `process-model-design-report.md` for the design rationale behind them) and read what they
   already do. This may turn out to be closer to *flipping a switch* than *building isolation
   from scratch*.
2. Write one small regression test first, independent of any fix: intentionally throw inside
   one tab's page script (e.g. a `<script>` that does `null.x`) and assert that (a) that tab
   shows an error state and (b) a second, unrelated open tab is still interactive afterward.
   Run it against the current code as-is. Whatever it reports **is** the real baseline — don't
   assume the JS-VM's per-realm isolation already contains this; confirm it.
3. If the test in step 2 already passes (Nova's own JS-VM realm isolation might already
   contain most script-level faults, independent of OS process boundaries), the actual gap is
   narrower than "no isolation at all" — likely just the uncaught-at-the-top cases (a bug in
   Nova's own engine code, not page script) and the Electron-level renderer crash path
   (already handled today by a full-window reload, which is coarse but not silent).

## Minimal first step, if step 2's test fails

If a fault in one tab's script *can* currently affect other tabs, the smallest useful fix is
not full multi-process — it's containing JS execution per tab within the existing single
renderer, before reaching for OS-level process boundaries:

- Wrap each tab's script execution entry point in the JS engine with a per-tab error boundary
  that catches, logs, and marks that tab as errored, without propagating into other tabs'
  execution context or global engine state.
- Only after that's in place and tested does moving to `child_process.fork()`-per-tab (real OS
  isolation, the thing TODO.md #4 already names) become the next increment — and at that
  point the existing dormant `ProcessManager` transport is the starting point, not a new
  design.

## Non-goals for this pass

- Full Chrome-style site-isolation / per-origin process model — explicitly out of scope; this
  doc is about "one bad tab doesn't wreck the browser," not full security-boundary isolation
  between origins.
- Changing the Electron `render-process-gone` → reload-the-window recovery path — it already
  does something reasonable (see `electron/main.cjs`); revisit it only if the per-tab fix
  above turns out to be insufficient on its own.

## Priority

Medium — this matters for daily-use resilience (P1 on the implementation roadmap), but per
step 2 above, the actual severity is unknown until that regression test is written and run.
Do that first; it may turn a "big parked feature" into a small, bounded fix.
