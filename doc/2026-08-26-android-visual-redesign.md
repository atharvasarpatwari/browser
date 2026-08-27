# Android Interface Redesign — "Nova Flash" Theme

**Date:** 2026-08-26
**Session:** Visual redesign of the native Android app's Compose UI theme
**Status:** Completed (source changes) — **build/install not verified this session, see Test Results**

---

## Summary

Replaced the Android app's Material 3 theme (coral-on-near-black, a stock-feeling
palette) with a considered "Nova" identity — a warm gold "flash" accent against
deep-space dark surfaces / warm daylight-paper light surfaces, with a cool violet
secondary and semantic colors kept deliberately separate from the brand accent
(e.g. the address bar's secure-connection indicator now uses a dedicated success
green instead of the primary accent). Most screens (tab strip, address bar,
bookmarks/history sheet, downloads sheet, context menu, error page) already
consumed `MaterialTheme.colorScheme.*` tokens rather than hardcoded colors, so
the new palette propagates through the whole app from `Color.kt` + `Theme.kt`
with only a few components needing direct edits.

## Design Rationale

- **Palette:** dark theme = deep space (`#10111A` background, not flat black)
  with a warm gold primary (`#F6B93B`, the "nova flash"); light theme = warm
  daylight paper (`#F6F6F2`, not stark white) with a darker ochre primary
  (`#A9720F`) for contrast. A cool violet (`NovaViolet` / `NovaVioletDeep`) is
  the secondary accent, used sparingly. Semantic colors (success/warning/error)
  are distinct hues from the brand accent, not derived from it.
- **Typography:** kept to the system default font family (no bundled font
  files were added — see Scope below) but tightened the type scale: explicit
  line-heights, negative letter-spacing on titles, and filled in `bodySmall`
  / `labelLarge` / `titleSmall` that were previously left to Material3
  defaults.
- **Shape:** added an explicit `Shapes()` to `MaterialTheme` (previously
  absent — Material3 defaults were used) for a slightly tighter corner radius
  scale on sheets/menus/dialogs; hand-tuned pill shapes (address bar, tab
  chips) were left as-is.
- **Cohesion fix:** `res/values/styles.xml` hardcoded `windowBackground` to
  white regardless of theme, causing a white flash before Compose mounts in
  dark mode. Added `res/values-night/styles.xml` so the pre-Compose window
  background/status bar match the new dark palette.

## Scope / Deliberately Not Touched

- **App launcher icon** (`ic_launcher_background.xml` + foreground vector) —
  left unchanged. The foreground vector's own colors weren't inspected, and
  changing just the background swatch risked a mismatched/illegible icon with
  no way to visually verify the result this session.
- **No custom font files added** — bundling a display typeface would need
  `.ttf` resources wired through Gradle, which couldn't be verified without a
  build.
- **DownloadsSheet, LibrarySheet (bookmarks/history), ContextMenuSheet,
  BrowserScreen, MainActivity** — not edited; they already read colors
  exclusively from `MaterialTheme.colorScheme`, so they pick up the new
  palette automatically.

## Files Modified

| File | Change |
|------|--------|
| `android/app/src/main/java/com/nova/browser/ui/theme/Color.kt` | Full palette rewrite — gold/ochre primary, violet secondary, deep-space/paper surfaces, distinct semantic colors, standalone incognito colors |
| `android/app/src/main/java/com/nova/browser/ui/theme/Theme.kt` | Wired new colors incl. `surfaceContainerHigh`; added `onSecondary`; added an explicit `Shapes()` |
| `android/app/src/main/java/com/nova/browser/ui/theme/Type.kt` | Refined type scale — line-heights, tracking, added `bodySmall`/`labelLarge`/`titleSmall` |
| `android/app/src/main/java/com/nova/browser/ui/components/AddressBar.kt` | Secure-connection lock icon now tinted with a dedicated success green instead of the primary accent |
| `android/app/src/main/java/com/nova/browser/ui/components/TabsBar.kt` | Incognito colors moved to theme package constants; selected-tab background now `surfaceContainerHigh`; removed a local `Color_Transparent()` wrapper in favor of `Color.Transparent` directly |
| `android/app/src/main/java/com/nova/browser/ui/components/ErrorPage.kt` | Warning icon now sits in a soft circular badge instead of bare on the background |
| `android/app/src/main/res/values/styles.xml` | `windowBackground`/`statusBarColor` now match the light palette instead of hardcoded white |

## Files Created

| File | Purpose |
|------|---------|
| `android/app/src/main/res/values-night/styles.xml` | Dark-mode pre-Compose window background, so launch doesn't flash white |
| `doc/2026-08-26-android-visual-redesign.md` | This document |

## Test Results

**Not run this session.** This session had file-level access to the repo (via
a desktop file bridge) but no shell/Gradle/adb access to the connected
machine or device — there was no `device_bash`-equivalent tool available, only
file read/write. Per this repo's Run & Verify Rule, that means these changes
are **unverified**: no `gradlew assembleDebug`, no install, no on-device check.

**Verification steps for whoever picks this up:**
```bash
cd android
gradlew.bat assembleDebug     # or: npm run android:assemble (from repo root)
gradlew.bat installDebug      # pushes to the connected device
```
Things worth checking specifically on device: light/dark mode toggle (system
theme switch) for the new window-background/status-bar match, the address
bar's secure/insecure icon color, tab strip selected-state contrast in both
themes, and the error page's new icon badge.

## Verification Note

The Kotlin files above were edited at a temporary shallow copy
(`E:\nova_1\com\nova\browser\...`) due to a file-bridge path-depth limit, and
need to be copied back over the real source tree
(`android\app\src\main\java\com\nova\browser\...`) before building — see the
chat for the exact copy-back step.

## Follow-up (2026-08-27)

Added `apply-android-redesign.bat` at the project root. It automates the
copy-back step above: copies `com\` over `android\app\src\main\java\com\`,
then deletes the temporary `com\` copy. Still no shell/Gradle access from
this session, so `gradlew.bat assembleDebug` / `installDebug` still need to
be run by hand after the script finishes.
