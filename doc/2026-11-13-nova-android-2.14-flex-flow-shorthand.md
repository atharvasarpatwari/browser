# Nova Android 2.14: `flex-flow` Was Never Expanded: The Ad-Block Test Page Was Off-Screen on the realme Tablet

**Date:** 2026-11-13
**Session:** "keep improving the nova app and update analytics.html and test on device" / "connect again and test"
**Status:** Code complete and tested offline. **Not yet checked on the realme tablet:** it went back to sleep with the 2.14 install prompt waiting (adb install timed out; the tablet still has 2.13). I do not unlock the screen or approve install prompts.

---

## Summary
On the realme RMX5264 (Android 16, 423x822 CSS px) adblock.turtlecute.org drew only "Support", "GitHub" and two overlapped buttons; the heading, gauge and card were missing. A temporary diagnostic (a per-element style and box dump, logged after render) showed the page's content box `#m_test` at x=439, past the 423 px viewport edge. The page's `body` says `flex-flow: column wrap`, and the engine never expanded the `flex-flow` shorthand: layout reads only `flex-direction` and `flex-wrap`, so the body was a row and the header and main content sat side by side.

## Root Causes

### 1. The `flex-flow` shorthand had no effect
**File:** `src/browser/rendering/css5/cascade.ts` (`expandShorthands`)
**Problem:** `body{display:flex;flex-flow:column wrap;min-height:100vh}` laid out as a row. Minimal page at 424x822: header 5x81 at (0,0), main 6x966 at (5,0), side by side.
**Root cause:** `flex-flow` is listed in the shorthand table but `expandShorthands` has no branch for it, so the declaration stayed as `flex-flow` and nothing read it. `flex`, `gap`, `overflow`, `place-*` and the rest each have a branch; this one was missed.
**Fix:** a branch that sets `flex-direction` and `flex-wrap` from the two tokens, in either order (the shorthand is kept too).

```ts
} else if (prop === 'flex-flow') {
  const f = new Map<string, string>([['flex-flow', decl.value]]);
  for (const t of decl.value.trim().split(/\s+/)) {
    if (/^(row|column)(-reverse)?$/i.test(t)) f.set('flex-direction', t.toLowerCase());
    else if (/^(nowrap|wrap)(-reverse)?$/i.test(t)) f.set('flex-wrap', t.toLowerCase());
  }
  if (f.size > 1) expanded = f;
}
```

After the fix the same minimal page gives header (0,0) 424x81 and main (0,81) 424x966, one column, as `flex-direction: column` alone does.

## Checked, not changed (recorded)
- **Why the emulator showed this page correctly while the realme did not** is not established. In node the page is laid out the same at both sizes. The emulator's earlier screenshots look like a column layout, so something other than this shorthand may have stacked the content there; I did not chase it.
- **A line-break change I tried first** (never wrap an auto-height column) had no effect on the minimal page and was reverted: the cause was the direction, not the wrapping.

## Not changed
- **realme tablet:** the 2.14 result is unchecked (see Status). 2.13 on the tablet still shows the broken layout.
- **OnePlus Pad:** not connected this session.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/css5/cascade.ts` | `flex-flow` expanded into `flex-direction` and `flex-wrap` (#1) |
| `android/app/build.gradle` | 2.13 (114) → 2.14 (115) |

## Files Created
| File | Purpose |
|------|--------|
| `tests/flex-flow-shorthand-214.test.ts` | `flex-flow: column wrap` stacks header and main in one column; both token orders expand; both tests fail with the source reverted |

## Test Results
```
npx vitest run tests/flex-flow-shorthand-214.test.ts → 2 passed; with src/ reverted (git apply -R): 2 failed
npx tsc --noEmit -p .              → clean
npx vitest run                     → Test Files 344 passed (344); Tests 11485 passed (11485)
gradlew --no-daemon -q :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-2.14.apk     → verified; versionCode 115, versionName 2.14

realme RMX5264 (Android 16, WebView 156, 720x1570, density 272), 2.13:
  example.com → renders correctly (text in six scripts, icon, link)
  adblock.turtlecute.org (cold and warm load, then scrolled) → only "Support", "GitHub" and overlapped "Re-test"/"Share"; no backgrounds, heading, gauge or card
  diagnostic build (temporary, not committed) → #m_test box x=439 w=407 (second column), nav>ul fixed right:-100% at x=439 (correct, off-screen), header at y=924
  logcat: no script errors; [render] html 7 · css 29 · style 119 · layout 78 · paint 9 · scripts 289 ms
realme, 2.14: install not completed (tablet asleep with the prompt showing); not tested
```
