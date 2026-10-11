# Android — Mobile-Native Chrome (Tab Switcher, Not a Desktop Tab Strip)

**Date:** 2026-09-14
**Session:** User asked for the Android app's own UI/look to be distinct from the web/desktop chrome, and to look like "a proper Android app" — not a copy of anything, a genuinely native mobile pattern the desktop side doesn't use.
**Status:** Completed

---

## Summary
The native Kotlin chrome's theme, colors, and individual components (`AddressBar`, `TabsBar`) were already solid, idiomatic Material 3 Compose — but the *layout* it assembled them into was the desktop pattern: a permanently-visible horizontal tab strip above the address bar, exactly how `DesktopLayout` (`src/ui/pages/browser-window.ts`) lays out the Electron chrome. Every mainstream Android browser (Chrome, Firefox, Edge, Samsung Internet) hides its tab list behind a tab-count button instead and shows one compact address-bar row — that's the thing that actually reads as "a proper Android app" rather than a browser window narrowed onto a phone screen.

## What Changed
- Replaced `BrowserScreen`'s `topBar` — previously a `Column` of `TabsBar` (full tab strip) + `AddressBar` — with a single `Row`: a tab-count button (square outline, tab count inside — the same visual language Chrome/Firefox use), the incognito toggle, and the address bar filling the remaining width.
- Added `TabSwitcherSheet` (new file, `ui/components/TabSwitcherSheet.kt`): a `ModalBottomSheet` listing every open tab (title, URL, close button, tap-to-select), plus a "New tab" action in its header. Opens from the new tab-count button. Built with the exact same `ModalBottomSheet` pattern `DownloadsSheet`/`LibrarySheet` already use — no new UI mechanism introduced.
- Deleted `TabsBar.kt` — its permanently-visible strip is now fully superseded by the tab-count button + `TabSwitcherSheet`, and it had no other callers.

## Notes
- `TabSwitcherSheet` rows are text-only (title + URL), not thumbnail cards — the engine doesn't capture a per-tab bitmap today, and building that capture pipeline is a separate, much larger feature than a layout change. A list is the honest, fully-functional version; `ponytail:` comment in the file marks the thumbnail-grid upgrade path for when that capture exists.
- Left the theme (`Theme.kt`/`Color.kt` — the gold/violet "nova flash" on deep-space palette) and the individual `AddressBar`/`DownloadsSheet`/`LibrarySheet` components untouched — they were already good, native-feeling Material 3 work; the actual problem was the desktop-shaped layout wrapped around them, not the components themselves.
- Verified on the real connected device (not just the emulator/test harness): screenshotted before (persistent tab strip, desktop-shaped) and after (compact single-row chrome), then tapped the tab-count button and screenshotted the tab switcher sheet actually opening with a real tab row and working "New tab"/close affordances.

## Files Modified
| File | Change |
|------|--------|
| `android/app/src/main/java/com/nova/browser/ui/BrowserScreen.kt` | Compact top-bar row (tab count + incognito + address bar) replacing the `TabsBar` + `AddressBar` column; added `TabCountButton`; wired `TabSwitcherSheet` |
| `android/app/src/main/java/com/nova/browser/ui/components/EngineWebView.kt` | Updated a doc comment referencing the now-deleted `TabsBar` |

## Files Created
| File | Purpose |
|------|---------|
| `android/app/src/main/java/com/nova/browser/ui/components/TabSwitcherSheet.kt` | The mobile-native tab-switcher bottom sheet |
| `doc/2026-09-14-android-mobile-native-chrome.md` | This document |

## Files Deleted
| File | Reason |
|------|--------|
| `android/app/src/main/java/com/nova/browser/ui/components/TabsBar.kt` | Fully superseded by the tab-count button + `TabSwitcherSheet`; no remaining callers |

## Test Results
```
Kotlin compile (gradlew assembleDebug)                            → BUILD SUCCESSFUL (only pre-existing,
                                                                     unrelated deprecation warnings)
node android/scripts/device-smoke-test.mjs (real device)          → all Tier 1 + Tier 2 checks passed
```
No TypeScript/web files touched this session, so the existing `npx vitest run` / Electron e2e suites are unaffected (last known green from the prior session's changes).

## Verification Steps
1. Built and installed the new APK on the connected Realme RMX5264, screenshotted the home screen: single compact top row (tab-count "1" badge, incognito icon, full-width address bar) — no more permanent tab strip.
2. Tapped the tab-count button and screenshotted the result: a bottom sheet titled "1 tab" with a gold "+ New tab" action and a real tab row (globe icon, "about:blank" title/url, close button).
3. Ran the full on-device smoke test (install, cold launch, boot-log markers, activity resumed, CDP bridge, `ChromeStateSnapshot` shape, `createTab()` round-trip) — all passed.
