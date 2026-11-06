# Nova Android 1.91: Tablet Check of 1.88–1.90; Column Flex Items Keep Their Content Height; Hidden Gmail No Longer Covers Other Tabs

**Date:** 2026-11-06
**Session:** "device is been connected so test on it and improvise it"
**Status:** Completed. Tested on the tablet (realme RMX5264, Android 16).

---

## Summary
1.90 was installed on the tablet (it had 1.46) and tested there:
- per-tab Back works;
- Gmail opens in compatibility mode from `www.gmail.com` and shows its final address;
- Find in page works on Google's sign-in page.

The tablet showed two bugs, both fixed in 1.91:
- IANA's home page panels collapsed and overlapped (#1);
- a new tab opened after Gmail kept showing Gmail (#2).

## Root Causes

### 1. `flex: 1 1 0` items in an auto-height column were 0 tall
**File:** `src/browser/rendering/layout-engine.ts` (flex item setup)
**Problem:** on www.iana.org at phone width, the three panels ("Domain Names", "Number Resources", "Protocol Assignments") stacked their headings on one another, and their link lists spilled over the footer. Reproduced offline with a saved copy of the page (`tests/fixtures/iana-home-2026`).
**Root cause:**
- At ≤1000px the panels are `flex-direction: column` items with `flex-grow: 1; flex-basis: 0`.
- A flex item's `min-height: auto` is its content height (CSS Flexbox §4.5), so in an auto-height column each panel is as tall as its content.
- Nova applied the automatic minimum only to rows. A column's main size was the sum of the 0 bases, so every panel was 0 tall.

**Fix:** a column item with `min-height: auto` that doesn't scroll gets its content height as its minimum main size. The container's auto height sums `max(basis, minimum)`.

```ts
if (!isHorizontal && (childStyle.get('min-height') ?? 'auto').trim() === 'auto'
    && !/hidden|scroll|auto|clip/.test(childStyle.get('overflow-y') ?? childStyle.get('overflow') ?? 'visible')
    && ((childStyle.get('height') ?? 'auto') === 'auto')) {
  ...
  item.minMainSize = Math.max(item.minMainSize ?? 0, contentHeight);
}
```

The spec's `min(content, specified height)` for items with a definite height is not handled. A `ponytail:` comment marks this.

### 2. The hidden Gmail page stayed on screen over another tab
**Files:** `android/.../ui/components/CompatWebView.kt`, `ui/BrowserScreen.kt`
**Problem:** after using Gmail, opening iana.org in a new tab showed the Gmail page, while the address bar said iana.org.
**Root cause:**
- `dumpsys activity top` showed the compatibility WebView correctly laid out at 0×0 and the engine view full size.
- The system WebView on Android 16 can draw into its own surface layer, so shrinking the view to zero left its last frame on top.

**Fix:** besides being zero-size, the compatibility view is set to `INVISIBLE` whenever its tab isn't the active one (a `visible` parameter applied in `update`).

## Not changed (recorded)
- **`height: 0` columns:** a column flex container with `height: 0` lays its `overflow: hidden` item out at content height. This happens with or without this round's change (checked by stashing it). `height: 0` seems to be treated as "no height".
- **Missing spaces (on the tablet):** in httpforever.com's bold headings with `letter-spacing: -.02em`, some spaces are lost ("Whydoes thissiteexist?"), and once in body text. Not reproduced offline: the offline rasterizer uses a different font. Saved as `tests/fixtures/httpforever-2026` for a later round.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | column items' automatic minimum height (#1) |
| `tests/flex-grid-172.test.ts` | 2 new cases (#1) |
| `android/.../ui/components/CompatWebView.kt` | `visible` parameter; INVISIBLE off its tab (#2) |
| `android/.../ui/BrowserScreen.kt` | passes `visible = compatActive` (#2) |
| `android/app/build.gradle` | 1.90 (91) → 1.91 (92) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/fixtures/iana-home-2026/` | saved www.iana.org home page (reproduces #1) |
| `tests/fixtures/httpforever-2026/` | saved httpforever.com page (missing-space investigation) |

## Test Results
```
npx vitest run tests/flex-grid-172.test.ts → 41 passed (2 new: column flex:1 1 0 items keep content height;
  overflow:hidden column item may shrink below content)
npx tsc --noEmit -p .              → clean
npx vitest run                     → Test Files 335 passed (335); Tests 11443 passed (11443)
npx eslint (changed files)         → 0 errors (10 warnings)
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-1.91.apk     → verified; versionCode 92, versionName 1.91
Offline: tests/fixtures/iana-home-2026 rendered at 412px → panels collapsed (before), laid out (after)
Tablet (realme RMX5264, Android 16, 720x1570):
  1.90 installed (was 1.46)
  per-tab Back: example.com → iana.org; opened example.org; switched back → Back → example.com, Back disabled
  typed www.gmail.com → suggestion row; Go → Gmail in compatibility mode, address bar workspace.google.com/...
  Find in page "Guest" on accounts.google.com → 1/2, both highlighted; Back in compatibility mode → previous page
  BUG #2 seen: new iana.org tab showed Gmail (compat view 0x0 per dumpsys, frame still drawn)
  BUG #1 seen: IANA home panels overlapped
  1.91 installed (the user approved realme's install check)
  Gmail tab, then iana.org in a new tab → IANA shown, panels laid out (doc/img/2026-11-06-nova-1.91-iana-tablet.png)
  tab switcher: Gmail tab titled "Gmail: Secure, AI-Pow..." / workspace.google.com; switching to it → Gmail shown
```
