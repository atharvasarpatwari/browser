# Pull-to-Refresh & Find-in-Page — On-Device Re-check (the two items left open by 1.9)

**Date:** 2026-10-21
**Session:** Re-check the two device checks `doc/2026-10-17-nova-android-ui-features.md` left pending ("re-check pending" for pull-to-refresh, "Pending" for find in page). Device: **OnePlus tablet OPD2305, Android 14** (`IZ9HSSBUYHG6G6AU`), landscape, 1720×2408 @ 360 dpi.
**Status:** Completed — both pass. No source code changed.

---

## Summary

Both features were driven as a user would on the attached device and both work. Pull-to-refresh reloads only past the release threshold and the reload really hits the network (so the 1.9 reload fixes — stuck "loading" state and cache-served reloads — hold up on device). Find in page reports the right match count, highlights, scrolls to each match, steps forward and back, and clears on close.

The build on the device is **1.25 (versionCode 26, installed 2026-10-20 23:10)**, i.e. the current line, not the 1.9 APK that was outstanding. That is the stronger check — the 1.9 behaviour is confirmed in the build people are actually running. (Side note, not acted on: `main`'s `android/app/build.gradle` is still `versionName "1.9" / versionCode 10`; the 1.10–1.25 code lives on unmerged branches while their docs are already in `doc/`.)

## How it was driven

Chrome DevTools (the `adb forward` + CDP route `android/scripts/inspect-live-state.mjs` uses) is **not available on this build** — no `webview_devtools_remote_<pid>` socket exists for `com.nova.browser`, because WebView contents debugging is off in a release build. So the whole pass was done through the real UI instead: `adb shell input tap/text/swipe` plus `adb exec-out screencap`, with a throwaway local server as the oracle.

Test page: a node server on `127.0.0.1:8099`, reachable from the device via `adb reverse tcp:8099 tcp:8099`, which
- counts every request and renders the count as `<h1>Load count N</h1>` (so a reload is visible on screen *and* countable at `/hits`),
- sends `cache-control: no-store`,
- emits 40 sections, with the word `needle` in exactly 7 of them (sections 1, 7, 13, 19, 25, 31, 37) — a known-answer find.

Script: `scratchpad/server.mjs` (throwaway, not added to the repo).

## Results

### Pull-to-refresh
| Check | Gesture | Expected | Result |
|------|---------|----------|--------|
| Full pull at top releases past threshold | `input swipe 1200 300 1200 1100 700` (≈800 px ≈ 355 CSS px, well past the 72 CSS px threshold) | reload | ✅ `/hits` 1 → 2, page repainted as "Load count 2" |
| Reload reaches the network, not the cache | same | server hit counter moves | ✅ counter incremented (root cause 7 of the 1.9 doc holds) |
| Tab does not stay stuck "loading" | same | bottom bar returns to ↻ | ✅ reload icon, not ✕, after the refresh (root cause 6 holds) |
| Short pull does not fire | `input swipe 1200 300 1200 400 500` (≈100 px ≈ 44 CSS px, under threshold) | no reload | ✅ `/hits` stayed 2 |
| Drag down mid-page does not fire | `input swipe 1200 300 1200 1200 700` while scrolled to section 7 | scroll only | ✅ `/hits` stayed 2 |

### Find in page
| Check | Expected | Result |
|------|----------|--------|
| Menu → **Find in page** opens the bar | find bar above the bottom chrome, keyboard up | ✅ |
| Typing `needle` counts matches | `1/7` | ✅ `1/7`, first match highlighted orange, all 7 shown as tick marks on the scrollbar |
| Next (⌄) ×2 | `3/7`, scrolled to section 13 | ✅ `3/7`, viewport on "needle text in section 13." |
| Previous (⌃) | `2/7`, scrolled to section 7 | ✅ `2/7`, viewport on "needle text in section 7." |
| Close (✕) | bar closes, highlights and tick marks cleared | ✅ |

## Off-device checks run first
```
grep: onPullRefresh -> page-scroll-controller.ts:137,153 + browser-window.ts:628 (reload)
grep: find/findNext/findPrevious/clearFind -> android-native-bridge.ts:111-113;
      BrowserViewModel.kt:508-513; FindBar.kt; BrowserScreen.kt:84
npx vitest run tests/page-scroll-controller.test.ts tests/android-native-bridge.test.ts \
  tests/navigation-bridge.test.ts
  -> Test Files 3 passed (3), Tests 112 passed (112)
```

## Files Modified
| File | Change |
|------|--------|
| (none) | verification-only session |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-10-21-pull-refresh-find-device-recheck.md` | This change log |

## Follow-ups (not done here)
- `doc/2026-10-17-nova-android-ui-features.md`'s *Verification* table still reads "re-check pending" / "Pending" for these two rows; this doc supersedes it.
- CDP-based device scripts (`android:smoke-test`, `android:inspect-live`) cannot attach to a release build. Either install a debug APK for those runs, or they stay UI-driven as here.
