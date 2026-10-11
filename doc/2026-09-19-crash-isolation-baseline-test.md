# A Parked "Big Feature" Was Actually Already Working — Confirmed, Not Assumed

**Date:** 2026-09-19
**Session:** Asked to implement code, repair, and test, with no specific target named. Rather than guess, went to `TODO.md` — a curated, already-triaged backlog this codebase maintains — and found item #6 ("Multi-Process / crash isolation, Phase 2, parked") explicitly pointing at `doc/crash-isolation-scoping.md`, which itself prescribes an exact first step that had never actually been carried out: write one regression test and let the real result decide the next move, instead of assuming.
**Status:** Completed

---

## Summary
`crash-isolation-scoping.md` (written 2026-08-27, per TODO.md) laid out a careful "don't build blind" plan for the long-parked "per-tab crash isolation" feature: before designing anything, write a test that intentionally throws inside one tab's page script and checks whether a second, unrelated tab still works afterward — because Nova's real architecture (one shared `PageRenderer`/`DomTree`/`LayoutEngine`/`PaintEngine`/`JsEventLoop` for the whole app, not one per tab) makes "isolation" mean something narrower here than it does in Chrome. That test had never actually been written. Wrote it, using real (non-mocked) engine components matching exactly what `main.ts` wires for the running app, and ran it.

**Both assertions passed against the current, unmodified code.** A page whose script throws (`null.x.y`) doesn't corrupt the shared pipeline or block whatever gets navigated to next — a completely unrelated page renders correctly right afterward, through the very same `PageRenderer` instance — and the fault is visibly logged via `console.error`, not silently swallowed. `runJS()`'s own per-script error handling, already wrapped by `PageRenderer.executeAllScripts()`, turns out to be sufficient containment for the specific fear this whole doc was scoped around.

## Root Cause
Not a bug — a backlog item carrying stale, unverified severity framing. `crash-isolation-scoping.md` explicitly said "the actual severity is unknown until that regression test is written and run. Do that first" — and then no session ever did, so the item sat parked at Medium priority under an assumption of unknown (implicitly assumed high) risk. Writing and running the prescribed test replaces that assumption with a real, tested answer: the risk this doc was worried about doesn't currently exist, so the "minimal first step" fix it also scoped (a per-tab error boundary) isn't needed, and the much bigger ask underneath it (real OS-level per-tab process isolation) is no longer urgent for this specific reason — freeing it to be re-scoped later on its own actual merits (real process-level fault tolerance, eventual site isolation) rather than under old, now-resolved uncertainty.

## Notes
- This is deliberately a **no production-code-change** session — the finding is that no fix was needed for the concern as scoped. Ponytail's own "does this need to exist at all?" ladder rung applies at the backlog level too: the correct action when a prescribed test passes is to record that and downgrade the item, not invent a fix to justify the investigation.
- Chose this specific backlog item over other open TODO.md entries because it was uniquely well-suited to "implement the code and repair and test" with no other steer: it already had a concrete, previously-written test spec waiting to be executed, a clear "confirm before scoping bigger" instruction, and — checked via `ListAgents` before starting — no overlap with the several other follow-up investigations already running in separate sessions from earlier today (DevTools reconciliation, CSP upgrade-insecure-requests, cookie/HTTP networking, and the real-network Electron hang).
- Real per-tab OS-level process isolation is still a legitimate, valid feature to eventually build (`TODO.md` #6's second half) — this session narrows *why* it would be built, not whether it's ever worth building.

## Files Modified
| File | Change |
|------|--------|
| `doc/crash-isolation-scoping.md` | Added a "Result (2026-09-19)" section documenting the test and its outcome; updated `Status`/`Priority` to reflect that step 2 ran and the "Minimal first step" fix isn't needed |
| `TODO.md` | Item #6 updated: marked step 2 done with the real result, re-scoped what's left as a separate, no-longer-urgent question; bumped "Last updated" |

## Files Created
- `tests/tab-script-fault-isolation.test.ts` — the regression test `crash-isolation-scoping.md` prescribed but that had never been written: a real (non-mocked) `PageRenderer` renders a throwing-script page, then an unrelated page through the same instance, asserting the second renders correctly and the fault is logged, not silent
- `doc/2026-09-19-crash-isolation-baseline-test.md` — this document

## Test Results
```
npx tsc --noEmit -p .                                          → 0 errors (repo-wide)
npx vitest run tests/tab-script-fault-isolation.test.ts         → 2/2 passed (both new)
npx vitest run (full suite)                                     → 225 files / 9277 tests passed (0 regressions)
```

## Verification Steps
1. Read `TODO.md` (last updated 2026-09-06) end to end looking for a well-scoped, non-overlapping next step, since the task named no specific target.
2. Checked `ListAgents` first and confirmed the DevTools-reconciliation, CSP, cookie/networking, and Electron-hang follow-ups flagged earlier today were already running in separate sessions — ruled those out to avoid duplicate work.
3. Found TODO.md #6 pointing at `doc/crash-isolation-scoping.md`, which prescribes an exact, never-executed first step (write one throw-inside-a-tab regression test, let the real result decide the next move) rather than designing isolation work blind.
4. Wrote `tests/tab-script-fault-isolation.test.ts` using real `HtmlParser`/`DomTree`/`CssParser`/`LayoutEngine`/`PaintEngine`/`ResourceLoader` instances (matching `main.ts`'s actual DI wiring shapes, not mocks) so the test exercises the real code path, not an idealized stand-in.
5. Ran it against the current, unmodified codebase: both assertions passed — the shared pipeline survives a throwing script and renders whatever comes next correctly, with the fault visibly logged.
6. Updated `crash-isolation-scoping.md` and `TODO.md` with the real, tested result instead of leaving the old "severity unknown, do this first" framing stale.
7. Ran the full test suite for regressions (this session made no production-code changes, only added a test and updated two docs).
