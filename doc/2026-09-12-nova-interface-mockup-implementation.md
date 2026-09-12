# Nova Interface Mockup Implementation (`.nova-*` UI Reconciliation)

**Date:** 2026-09-12
**Session:** Wire the `Main-html` design mockup into the real Nova UI source by rewiring the imperative DOM views, desktop layout, and chrome structure to Nova's existing `.nova-*` design system in `styles.css`.
**Status:** Completed

---

## Summary

The `Main-html/` (two-artboard) mockup was reconciled into the live desktop UI: `DesktopLayout` now builds a `.nova-chrome` shell (`.nova-titlebar` with window controls → `.nova-tabbar` → `.nova-navbar` → `.nova-bookbar` → content/status areas), and the toolbar / tab-strip / address-bar / bookmark-bar / status-bar views now emit `.nova-*` components instead of the older inline-styled class names. The desktop address bar lost its styling because each view `build()` overwrote the layout-assigned container class — fixed by making the **layout own each bar's root class** while views only build children.

## Root Causes

### 1. Views clobbered layout-assigned area classes (pre-existing regression, surfaced in the Android-bridge suite)
**File:** `src/ui/components/{toolbar,address-bar,tab-strip,bookmark-bar,status-bar}/*.view.ts`
**Problem:** Each view's `build()` ran `this.container.className = 'nova-…'`, overwriting the class the layout gave the section. On mobile, `MobileLayout` creates `.mobile-status-bar`/`.mobile-address-bar`, but the attached `StatusBarView`/`AddressBarView` replaced those with `nova-statusbar`/`nova-addressbar`. The regression test `tests/android-native-bridge.test.ts` ("hideChromeUI also hides MobileLayout's own chrome on a phone-width viewport") queries `.mobile-status-bar` — never found, so `hideChromeUI` appeared broken. Verified pre-existing by running the test on the stashed (pre-change) tree — it failed there too.
**Fix:** Removed `container.className = …` from all five view `build()` methods. The layout now owns root classes exclusively — `DesktopLayout` already assigns `nova-tabbar`/`nova-navbar`/`nova-bookbar`/`nova-statusbar`/`nova-titlebar` to its sections, and the toolbar's address slot is created as `address-bar-slot nova-addressbar` so the `.nova-addressbar` pill styling still applies. Mobile areas keep their `mobile-*` classes, and the suite's hideChromeUI test passes again.

### 2. Desktop layout didn't match mockup chrome hierarchy
**File:** `src/ui/layout/desktop-layout.ts`
**Problem:** Layout built an empty `menu-bar`/`title-bar` section pair without the mockup's titlebar→tabbar→navbar→bookbar stacking, so the new `.nova-*` chrome had no host.
**Fix:** Rewrote `build()` to emit `.nova-chrome` → `.nova-titlebar` (with `.nova-wc` close/minimize/maximize buttons + `.nova-titlebar-label` brand name) → `.nova-tabbar` → `.nova-navbar` → `.nova-bookbar` (when enabled) → `.nova-content-area` (flex host for the toggled `.nova-sidebar.open` + `.content-area`) → `.nova-statusbar`. `DesktopLayoutAreas.menuBar` → `titleBar`; added `brandName?: string` (default `'Nova Browser'`).

### 3. Toolbar carried a dead `showTrafficLights` config
**File:** `src/ui/components/toolbar/toolbar.view.ts`
**Problem:** Traffic lights live in the mockup titlebar; the mockup has no window-controls in the toolbar, and the config was unused.
**Fix:** Dropped `showTrafficLights` from the toolbar view; titlebar now provides window controls. Reload button flips to a `stop` glyph with a `.loading` class while loading; shield becomes a `.nova-nav-btn` with a green tint when enabled; `.nova-menu-btn` hamburger emits `menuClick`.

## Files Modified

| File | Change |
|------|--------|
| `src/ui/layout/desktop-layout.ts` | Builds `.nova-chrome` shell; titlebar replaces menu-bar; `.nova-*` sections; `DesktopLayoutAreas.menuBar` → `titleBar`; `brandName` option. |
| `src/ui/components/toolbar/toolbar.view.ts` | `.nova-navbar` with inline SVG nav buttons, `address-bar-slot nova-addressbar`, `.nova-star`, divider, shield, `.nova-menu-btn`; dropped `showTrafficLights`; removed root-class overwrite. |
| `src/ui/components/tab-strip/tab-strip.view.ts` | `.nova-tabbar`/`.nova-tab` (+ active/pinned/loading) with favicon/title/close, `.nova-new-tab`; kept drag-drop/context-menu/incremental render; removed root-class overwrite. |
| `src/ui/components/address-bar/address-bar.view.ts` | `.nova-security` icon, `.nova-addressbar-input`, `.nova-dropdown`/`.nova-dropdown-item`; kept keyboard nav + blur-delay; removed root-class overwrite. |
| `src/ui/components/bookmark-bar/bookmark-bar.view.ts` | `.nova-bookbar`/`.nova-bk-folder`/`.nova-bk-item`; removed root-class overwrite. |
| `src/ui/components/status-bar/status-bar.view.ts` | `.nova-statusbar` with shield pill, secure-dot, protocol, zoom controls; removed root-class overwrite. |
| `src/ui/pages/browser-window.ts` | `hideChromeUI` branch also hides `areas.titleBar` (in addition to toolbar/tabBar/bookmarkBar). The mobile regression was fixed purely by the view class-clobbering change — the mobile `hideChromeUI` branch was already correct once `MobileLayout`'s `mobile-*` classes survive attachment. |

## Files Created

| File | Purpose |
|------|---------|
| (none) | `Main-html/` is the reference mockup already present from the 09-10 session; no new source files. |

## Test Results

```
npx tsc --noEmit                              → exit 0, no output
npx vitest run tests/android-native-bridge.test.ts → 1 file, 37/37 passed (was 1 failed pre-fix)
npx vitest run tests/status-bar.test.ts tests/bookmark-bar.test.ts tests/tab-strip.test.ts tests/toolbar.test.ts tests/address-bar.test.ts → 5 files, 84/84 passed
npx vitest run (full suite)                   → 216 files, 9,179/9,179 passed, 0 failed
```

## Verification

- `git stash` on `src/` reproduced the mobile regression failure on the pre-change tree, confirming it was pre-existing, then `git stash pop` restored the work.
- Probing test (`tests/zz-probe-mobile.test.ts`, since removed) confirmed the class-name clobbering mechanism (`.mobile-status-bar` absent because `nova-statusbar` replaced it) before the fix.
- Full suite exercised with my changes applied; 9,179 passing, 0 failing.