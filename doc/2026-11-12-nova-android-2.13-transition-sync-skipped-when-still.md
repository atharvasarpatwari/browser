# Nova Android 2.13: Animation Frames 7.5 Times Cheaper: The Transition Walk Is Skipped When Nothing Changed

**Date:** 2026-11-12
**Session:** "keep improving the nova app and update analytics.html and test on device"
**Status:** Completed. Measured offline (the real ad-block test page replayed in the engine) and checked on the Android emulator. The OnePlus Pad was not connected this session (adb listed no device), so the tablet was not tested.

---

## Summary
A page whose only activity was one infinite CSS animation (the ad-block test's gauge) cost 75 ms per frame. 66 ms of that was the CSS-transition sync walking every element and copying its whole computed style, every frame, although no style had changed. It now runs only when the DOM or a style changed: 75 ms to 10 ms per frame.

| Idle page, gauge animation only (engine, replay of adblock.turtlecute.org, 400x900) | 2.12 | 2.13 |
|---|---|---|
| Frame cost (ms) | 75.2 | **10.0** |
| of which `CssTransitionEngine.sync` | 66.3 | 0.0 |
| of which paint / layout / style / animator sync / svg pass | 5.5 / 0.8 / 0.3 / 1.7 / 0.4 | 6.6 / 0.9 / 0.4 / 1.5 / 0.5 |
| Frames run in 6 s (no vsync throttle in node, so frames run back to back) | 79 | 566 |

## Root Causes

### 1. The transition engine diffed every element's style on every frame
**File:** `src/browser/rendering/css-transitions.ts` (`CssTransitionEngine.sync`)
**Problem:** with the test finished and only the gauge's `animate_lt_wave` keyframes running, each frame took ~75 ms although style, layout and paint together were ~7 ms. On a phone a frame that long keeps a core busy for as long as the page is open, and it delays the page's own JavaScript.
**Root cause:** `sync()` runs after every style recalculation, and a frame runs one even when nothing is dirty. It walked the whole document twice: once parsing every element's `transition-*` properties, once copying every element's computed style (`new Map(style)`) into the snapshot for the next diff. With no style change the diff can never find a difference.
**Fix:** `sync()` returns at once when the DOM's mutation counter has not moved since the last sync. `setComputedStyle`, attribute, child and text changes all record a mutation, so any real change still runs the full diff. A tree without a counter (the test mocks) always syncs, as before.

```ts
const stamp = this.domTree.mutationCount;
if (stamp !== undefined && stamp === this.syncedAt) return;
this.syncedAt = stamp ?? -1;
```

## Checked and not a bug (recorded)
- **Result card not painted after the test finished (emulator):** the card showed "Total:" with no numbers and Share dimmed. Replaying the page offline showed the DOM correct ("Total: 130", "130 blocked", "0 not blocked") and a frame running right after the update (with and without any change of mine). The test simply takes longer than a minute on the emulator; on a later look the card was complete. I had added a frame request on every DOM mutation, measured that it changed nothing, and reverted it.
- **Tabs lost on update (tablet showed 40 tabs, then 2 after installing 2.12):** not reproduced. On the emulator 8 tabs stayed 8 after `install -r` and a relaunch. The tablet was not connected, so what happened there is unknown.

## Not changed (recorded)
- **While the test runs, frames cost 1.8 to 3.2 s each** (replay, node): style recalculation 1.0 s growing to 2.6 s, layout 0.3 to 0.7 s. These frames block the page's JavaScript and are the likely reason the test is slow on a phone. The incremental style pass falls back to a full pass when more than 40% of the page is dirty (`page-renderer.ts`, `restyleDirtyElements`); that is the next thing to look at.
- **End-to-end test time on the emulator is noisy and is not a result of this change.** Single runs, 2.13 first: 51 s (2.13) and 129 s (2.12). A later 2.13 run was still unfinished after 135 s with 12 restored tabs. Do not read a speedup from these.
- **realme tablet and OnePlus Pad:** not connected, not tested.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/css-transitions.ts` | `sync()` skipped while the DOM mutation counter is unchanged (#1) |
| `android/app/build.gradle` | 2.12 (113) → 2.13 (114) |
| `tests/animation-track-b.test.ts` | one test added to the `CssTransitionEngine` group |

## Test Results
```
npx vitest run tests/animation-track-b.test.ts → 28 passed; with src/ reverted (git apply -R): the new test fails (27 passed, 1 failed)
npx tsc --noEmit -p .              → clean
npx vitest run                     → Test Files 343 passed (343); Tests 11483 passed (11483)
gradlew --no-daemon -q :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-2.13.apk     → verified; versionCode 114, versionName 2.13

Profile (a throwaway test replaying the saved page, its CSS and its script in the engine, all requests rejected; per pipeline step, mean over 6 s once the test had finished):
  2.12: 79 frames, 75.2 ms each = transitionSync 66.3 + animator.sync 1.7 + paint 5.5 + layout 0.8 + style 0.3 + svg walk 0.4
  2.13: 566 frames, 10.0 ms each = transitionSync 0.0 + animator.sync 1.5 + paint 6.6 + layout 0.9 + style 0.4 + svg walk 0.5

Android emulator (NovaEmu, Android 14, WebView 113), adblock.turtlecute.org in the engine:
  2.13 install "Success"; the page loads, the gauge liquid animates inside its circle, the score reaches 100%; no "Uncaught error", no crash
  (end-to-end timings: see "Not changed")
OnePlus Pad Go: not connected (adb devices listed nothing)
```
