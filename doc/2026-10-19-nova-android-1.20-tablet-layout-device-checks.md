# Nova Android 1.20 — Tablet Layout Fix, First Full Device Run on the OPD2305 Tablet

**Date:** 2026-10-19
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html", round 10. The tablet was locked, so a form-controls plan was written first (`2026-10-19-nova-form-controls-plan.md`). The approval question was interrupted when the user said the tablet was on ("its on now"), and the round switched to on-device testing. That run found the tablet-only layout bug fixed here.
**Status:** Completed. Verified on the tablet. The form-controls plan is still awaiting a decision.

---

## Summary
- **First full device run on the tablet:** an OPD2305 on Android 14, landscape 2408×1720, running 1.19.
- **What passed** (it covers 1.16–1.19):
  - real fonts in every script;
  - script-added styles (the faded, smaller translations);
  - link blue and underlined;
  - touch scrolling;
  - pull-to-refresh;
  - reload;
  - find with auto-focus.
- **Two tablet-only bugs:**
  - the web UI's desktop status strip ("Ready · 0 blocked · HTTPS · Secure · − 100% +") showed above Nova's native bottom bar;
  - a white column ran down the left edge of the page.

  Both came from the page UI picking its *desktop* layout, because the tablet's WebView is wider than 768 px. Fixed and re-verified on the tablet in **1.20** (versionCode 21).

## Root Cause
### Android app on a wide screen got the desktop web layout
**File:** `src/ui/pages/browser-window.ts`
**Problem:**
- `mount()` chose the layout with `window.innerWidth < 768`. A phone is below that, so it got `MobileLayout`, where `hideChromeUI` hides everything except the content.
- The tablet's WebView is about 1070 CSS px wide, so it got `DesktopLayout`. Its `hideChromeUI` branch hides the title bar, toolbar, tab bar and bookmark bar, but **not** the status bar. The layout's sidebar column also stayed in place, which was the white band.

**Fix:** inside the Android app the mobile layout is used at any width:
```ts
const isMobile = this.config.hideChromeUI || (typeof window !== 'undefined' && window.innerWidth < 768);
```
`hideChromeUI` is set only when the native shell is present (`isNativeHostPresent()` in `main.ts`), so the desktop and web builds are unchanged.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | `hideChromeUI` → mobile layout at any width |
| `tests/page-context-menu-platform.test.ts` | finds the content area in either layout (`.content-area, .mobile-content`); under `hideChromeUI` it's now the mobile one, as on a phone |
| `android/app/build.gradle` | 1.19 (20) → 1.20 (21) |
| `android/app/src/main/assets/*` | rebuilt bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/browser-window-native-tablet.test.ts` | 2 tests at `innerWidth = 1200`. With `hideChromeUI`, no status bar, toolbars, sidebar, title or tab bar is visible: this failed before the fix, listing `nova-sidebar` and `nova-statusbar…`. Without it, the desktop web build still shows its chrome |
| `doc/2026-10-19-nova-form-controls-plan.md` | Plan (awaiting approval): paint form controls, keyboard overlay for typing, form submission, script `value`/`checked` |
| `doc/2026-10-19-nova-android-1.20-tablet-layout-device-checks.md` | This change log |

## Test Results
```
npx vitest run tests/browser-window-native-tablet.test.ts tests/page-context-menu-platform.test.ts -> 3 passed (3)
npx tsc --noEmit -> exit 0
npx vitest run   -> 273 files, 10511 passed (10511)
gradlew :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug -> BUILD SUCCESSFUL; 36 Kotlin tests, 0 failures
apksigner verify Nova-1.20.apk -> verified (1,523,448 B)
```

## Verification on the tablet (OPD2305, `IZ9HSSBUYHG6G6AU`, Android 14)
Every input went through the guarded helpers, which tap only when Nova owns the focused window.

| Check | Result |
|-------|--------|
| example.com: real fonts, Arabic/Chinese/French/Russian/Spanish | **Pass** (1.16) |
| Translations smaller and faded (`p+p` from the script-added `<style>`) | **Pass** (1.17) |
| "Learn more": blue and underlined | **Pass** (1.17) |
| No script errors in logcat | **Pass** (1.15) |
| Touch scroll | **Pass** |
| Status strip above the bottom bar; white left column | **Fail on 1.19 → fixed in 1.20**: after installing 1.20, the page fills the width and has no strip |
| Pull-to-refresh | **Pass**: `fetch[3] GET https://example.com/` |
| Reload button | **Pass**: `fetch[4]` |
| Find from the menu, typing immediately | **Pass**: focus and keyboard came up; "service" 1/2, highlighted, with scroll-track markers |
| Text crispness | soft at 2.25× density (pages are rastered at CSS px); a known ceiling |

## What's new in Nova 1.20 (user-facing)
- On tablets, pages fill the screen edge to edge, and the stray status line above the bottom bar is gone.
