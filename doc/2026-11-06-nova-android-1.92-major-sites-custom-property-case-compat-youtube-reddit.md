# Nova Android 1.92: Major Sites on the Tablet; Custom Properties Are Case-Sensitive; YouTube and Reddit in Compatibility Mode

**Date:** 2026-11-06
**Session:** "try all the main websites on the device"
**Status:** In Progress. 4 of 20 sites were run before the tablet disconnected; the other 16 wait for it to reconnect.

---

## Summary
A scripted run on the tablet (1.91) loaded major sites one after another in one tab. Before each step it checked that Nova was in the foreground and no call was active.

| Site | 1.91 on the tablet |
|------|--------------------|
| google.com | Logo and search box fine; footer links invisible (white on grey) → #1 |
| youtube.com (m.youtube.com) | Grey placeholder boxes only; videos never loaded → #2 |
| en.wikipedia.org | Good |
| reddit.com | Only the orange loading logo → #2 |

After reddit.com the run stopped: adb lost the tablet. The script's guard caught the empty reply and sent no further input.

## Root Causes

### 1. Custom property names were lowercased, so `var(--bbQxAb)` never matched
**Files:** `src/browser/rendering/css5/parser.ts`, `src/browser/rendering/css5/cascade.ts`
**Problem:** Google's footer links ("Dark theme: off", Settings, Privacy…) were white on the tablet (black offline) instead of grey.
**Root cause:**
- Google defines its colours as mixed-case custom properties (`:root{--bbQxAb:#4e5059}`) and uses `color: var(--bbQxAb)`.
- The parser and cascade lowercased every declaration's property name, so the stored name was `--bbqxab`.
- `var()` looks names up as written (custom properties are case-sensitive, CSS Variables §2), so it found nothing and the colour was dropped.
- Found by parsing Google's `:root` style block on its own: the declarations came out as `--coemy`, `--vze0jb`….

**Fix:** a `cssPropName()` helper keeps `--custom` names as written and lowercases the rest. It is used at all 8 places that lowercased property names (stylesheet and inline declarations, cascade entries, inline overrides).

```ts
export const cssPropName = (p: string): string => (p.startsWith('--') ? p : p.toLowerCase());
```

After the fix, the offline render of the saved page gives the footer links `color=#4e5059`.

### 2. YouTube and Reddit are built entirely by script
**File:** `android/.../CompatSites.kt`
**Problem:** YouTube showed placeholder boxes and Reddit showed only its loading logo.
**Root cause:** both are single-page apps (Polymer / web components) whose content is created by large scripts that Nova's engine can't run yet. This is the same limit as Gmail in 1.88.
**Fix:** `youtube.com` and `reddit.com` (and their subdomains) open in compatibility mode by default. The menu's "Compatibility mode" entry can switch either one back to Nova's engine.

## Not changed (recorded)
- **Timing check under load:** `device-findings-137 › rasterizes a frame quickly` took 3.06 s against a 2.5 s budget in one full run. It passed 3 of 3 times when run alone, and in an idle full run (11446 passed), so the cause is CPU contention, as before.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/css5/parser.ts` | `cssPropName` helper; used for declaration names (#1) |
| `src/browser/rendering/css5/cascade.ts` | uses `cssPropName` (#1) |
| `tests/cascade-values-175.test.ts` | 3 new cases (#1); they fail without the fix |
| `android/.../CompatSites.kt` | youtube.com, reddit.com by default (#2) |
| `android/.../CompatAndSuggestionsTest.kt` | 1 new test (#2) |
| `android/app/build.gradle` | 1.91 (92) → 1.92 (93) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/fixtures/google-home-2026/index.html` | saved mobile Google home page (reproduces #1) |

## Test Results
```
npx vitest run tests/cascade-values-175.test.ts → 63 passed (3 new); with css5/ stashed: 3 failed (the new ones)
npx tsc --noEmit -p .              → clean
npx eslint (changed files)         → 0 errors (16 warnings)
npx vitest run                     → first run: 1 failed (timing gate, see above) | 11445 passed
                                     idle re-run: Test Files 335 passed (335); Tests 11446 passed (11446)
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0
apksigner verify Nova-1.92.apk     → verified; versionCode 93, versionName 1.92
Tablet (1.91, realme RMX5264): google.com, youtube.com, en.wikipedia.org, reddit.com loaded (table above);
  the remaining 16 sites (amazon.in, x.com, facebook.com, instagram.com, linkedin.com, github.com,
  stackoverflow.com, bbc.com, cnn.com, nytimes.com, yahoo.com, bing.com, duckduckgo.com, apple.com,
  microsoft.com, netflix.com) wait for the tablet to reconnect.
```
