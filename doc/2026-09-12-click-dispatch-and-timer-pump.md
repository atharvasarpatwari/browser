# Click/Pointer Event Dispatch + Post-Load Timer Pump

**Date:** 2026-09-12
**Session:** Wire real mouse-click dispatch through to page JS `addEventListener` handlers on the canvas rendering path, and fix the timers/reflow gaps that surfaced while verifying it.
**Status:** Completed

---

## Summary
Clicking on a rendered page did nothing — no `addEventListener('click', …)` handler on the page ever ran. Root-caused to a straightforward missing wire: hit-testing (`ILayoutEngine.getElementAtPoint`) and DOM event dispatch (`dom-bindings.ts`'s `dispatchEvent`) already existed and worked individually, but nothing connected a real canvas click to them. Wiring that connection surfaced two further, more serious bugs along the way: page JS timers (`setTimeout`/`setInterval`/`requestAnimationFrame`) silently failed to invoke their callback on **every** firing outside of the page's initial synchronous script run, and DOM mutations made from an event handler or timer callback never triggered a repaint. Both are fixed; a page can now run indefinitely-scheduled JS the way a real browser does, not just its first synchronous pass.

## Root Causes
1. **No click-to-DOM wiring on the canvas path.** `content-renderer.ts` only tracked hover (`wireLinkHoverTracking`) for the separate iframe rendering path. The canvas path (Nova's own engine) had no mouse-event handling at all, even though hit-testing and event dispatch both already existed and were each independently correct.
2. **Timer/rAF callbacks threw and were silently swallowed outside the initial script run.** `Interpreter.run()` registers itself as the global JS-function caller (`setGlobalCaller(this)`) only for the duration of its own synchronous execution, resetting it to `null` in a `finally` block once done. `EventLoop.runOnce()`'s macrotask/rAF execution paths never re-registered an interpreter before invoking a due callback, so any `setTimeout`/`setInterval`/`requestAnimationFrame` callback that fired after the page's scripts finished running hit `callJSFunction`'s `throw new Error('No JS interpreter registered …')` path — caught and discarded by `runOnce`'s own `catch { /* swallow */ }`. This affected **every** page with any script that used a timer, not just this session's click-driven one; it was invisible because failures were silent.
3. **No page-level timer pump existed at all.** Even with (2) fixed, nothing was calling `EventLoop.runOnce()` after the initial `executeAllScripts()` pass returned, so a page's timers only ever had a chance to fire during that one synchronous window — a `setTimeout(fn, 500)` registered by an event handler had no driver to ever check it again.
4. **DOM mutations from post-load JS never triggered a repaint.** `ReflowRepaintController.requestFrame()` (the trigger that turns queued DOM mutations into an actual re-layout/re-paint/re-render) is only invoked explicitly by existing call sites (initial render, lazy-load image completion) — nothing called it after a click handler or timer callback mutated the DOM, so the mutation was correctly recorded but never painted.

## Notes
- Root cause 2 is the most consequential: it means **no page-level JS timer has ever fired correctly after a page's scripts finished executing**, for the entire lifetime of the engine until this fix — independent of the click-dispatch feature that surfaced it. The fix is in the one shared `EventLoop.runOnce()` used by every caller, not duplicated per call site.
- `EventLoop.getInterpreter()` was added as a minimal public accessor (mirroring the existing `setInterpreter()`) so `PageRenderer.dispatchPointerEvent()` can also re-register the interpreter around its own direct, one-off `callJSFunction` call (dispatching the click event itself happens outside `runOnce()`, so it needs the same guard independently).
- The pump ticks at a fixed 16ms (~60fps) interval per rendered page, mirroring browser frame cadence; it is started after each `executeAllScripts()` call and stopped on the next navigation or on `dispose()` so a replaced/closed page's timers don't keep running in the background.
- Click coordinates are mapped from on-screen canvas pixels to the engine's render-buffer pixel space via `canvas.width / boundingClientRect.width` (and height) — correct as long as the canvas's buffer and its CSS box share the same aspect ratio, which `page-renderer.ts` already guarantees by sizing the render viewport to the content area's actual `clientWidth`/`clientHeight`.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/js/event-loop.ts` | `runOnce()` now re-registers the global JS caller around both the due macrotask and any rAF callbacks (root cause 2); added `getInterpreter()` accessor |
| `src/browser/engine/page-renderer.ts` | Added `dispatchPointerEvent(type, x, y)` (hit-test → wrap → dispatch); added a 16ms real-time pump that ticks the page's `EventLoop` and requests a repaint after each tick; pump starts after script execution and stops on navigation/dispose |
| `src/browser/engine/browser-engine.ts` | Added `dispatchPointerEvent` to `IPageRenderer`/`IBrowserEngine` (+ `NullPageRenderer` stub) and a `BrowserEngine` passthrough, mirroring the existing `getPageLayoutEngine()` pattern |
| `src/browser/js/index.ts` | Re-exported `wrapElement` from `dom-bindings` (needed by `page-renderer.ts`) |
| `src/ui/components/content-renderer/content-renderer.ts` | Added `setClickHandler()` and a real `click` listener on the rendered canvas, converting on-screen coordinates to render-buffer coordinates |
| `src/ui/pages/browser-window.ts` | Wired `contentRenderer.setClickHandler()` to `browserEngine.dispatchPointerEvent('click', x, y)`, mirroring the existing `setLinkHoverHandler` wiring |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-09-12-click-dispatch-and-timer-pump.md` | This document |

## Test Results
```
npx tsc --noEmit -p .                                            → 0 errors (repo-wide)
npx vitest run                                                    → 222 files / 9216 tests passed
npx playwright test --config=playwright-electron.config.cjs       → 4/4 passed
  (electron-smoke, fidelity-audit, keep-alive, plus the scratch
   interactive-click/timer fixture used to verify this fix)
```

## Verification Steps
1. Built a minimal fixture page (400×300 click target + status text) with a `click` handler that increments a counter, updates `textContent`, and schedules a `setTimeout` that updates `textContent` again 500ms later.
2. Loaded it in the real Electron app via Playwright (`electron.launch`), clicked the target at real screen coordinates, and screenshotted before/after.
3. Before the fix: click had no visible effect at all (`getDomListeners` lookups matched correctly and `dispatchEvent` ran, but the actual page repaint never happened because nothing requested a reflow frame).
4. Diagnosed the timer/interpreter bug via targeted temporary instrumentation (in `invokeDomListeners`, `EventLoop.runOnce`, `dom-tree.ts`'s `setTextContent`) that traced the exact silent-throw point (`No JS interpreter registered — cannot call non-native function`), then removed all instrumentation once root-caused (confirmed via `grep -r "DEBUG-" src/` returning nothing).
5. After both fixes: screenshot shows `Clicked 1 time(s), timer fired!` — click dispatch, DOM mutation, repaint, and the delayed timer callback all confirmed working end-to-end in the real app.
