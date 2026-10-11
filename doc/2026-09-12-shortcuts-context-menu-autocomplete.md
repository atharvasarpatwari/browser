# Tab Shortcuts, Page Context Menu, Fullscreen, and Real Address Bar Autocomplete

**Date:** 2026-09-12
**Session:** User repeated the same request a third time — continued adding real-browser table-stakes features on top of today's toolbar/menu work.
**Status:** Completed

---

## Summary
Added four things every real browser has that Nova's didn't: Ctrl+T/Ctrl+W/Ctrl+Tab tab shortcuts, a right-click context menu on the actual rendered page (not just the tab strip), F11 fullscreen wiring, and — the biggest piece — real address bar autocomplete backed by actual bookmark and history search instead of an empty, wired-to-nothing UI shell.

## What Was Built
1. **Tab keyboard shortcuts** (`browser-window.ts`): Ctrl/Cmd+T (new tab), Ctrl/Cmd+W (close active tab, creating a fresh one if that was the last), Ctrl+Tab / Ctrl+Shift+Tab (cycle tabs forward/back). None of these existed anywhere in the codebase before today (confirmed via repo-wide grep) — the only existing shortcuts lived entirely in `address-bar.view.ts` (Alt+Left/Right, F5/Ctrl+R, Ctrl+L, Escape).
2. **Right-click context menu on page content** (`content-renderer.ts` + `browser-window.ts`): a real `contextmenu` listener on the canvas, hit-testing through the already-existing `resolveContextTarget()` (previously only ever called from the Android long-press bridge) to show Back/Forward/Reload, plus Open-Link-in-New-Tab/Copy-Link-Address when right-clicking a link, and Copy-Image-Address over an image. Reuses the same `ContextMenu` component as the tab strip and the new hamburger menu.
3. **F11 fullscreen**: wired to the already-built, already-DI-registered-and-started `WindowControls.toggleFullscreen()` (`src/platform/shared/window-controls.ts`), which previously had zero callers anywhere in the app — real plumbing with no button, shortcut, or menu item pointing at it.
4. **Real address bar autocomplete**: the suggestions dropdown UI (`address-bar.view.ts`) was fully built — rendering, arrow-key navigation, click-to-navigate, ARIA attributes — but `IAddressBar.setSuggestions()` had zero callers anywhere in the codebase, and there was no `input` listener wired to any data source. Added a debounced (`onInput` → 150ms) live query against `IBookmarkService.search()` and `IHistoryService.query({query})` — both already-real, already-used-elsewhere APIs — merging and deduping the results into the existing suggestion list.

## Notes
- Context menu coordinates needed two different spaces: the click handler already converts to content-buffer-space (for `resolveContextTarget`'s hit-testing, which operates in the engine's layout coordinate system), but `ContextMenu.show(x, y, ...)` needs real viewport pixels to position the dropdown on screen. `ContentRenderer.setContextMenuHandler()` now passes both.
- F11 was verified to invoke `toggleFullscreen()` without throwing and with no page errors, but Playwright's synthetic `keyboard.press('F11')` did not visibly change `document.fullscreenElement` in testing — a known category of limitation where Chromium's Fullscreen API resists synthetic/automated activation more strictly than other gated APIs (autoplay, clipboard, etc.). This could not be conclusively verified end-to-end via automation; it may still work correctly for a real physical keypress, since the underlying `WindowControls` plumbing and BrowserWindow config (`fullscreenable` is not disabled) both look correct.
- The address bar's suggestion strings are plain URLs (no separate title), matching the existing `AddressBarState.suggestions: readonly string[]` shape — clicking a suggestion calls `model.setValue(url)` directly (this click-to-navigate wiring already existed and worked; only the data source was missing). A richer title+URL suggestion format would need a small type change to the existing interface, not attempted here to keep the diff focused.
- A sequence-number guard (`suggestSeq`) drops stale async suggestion results if a newer keystroke's query resolves out of order.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | Added `onBrowserShortcutsKeydown` (Ctrl+T/W/Tab, F11) + `cycleTab()`; added `showPageContextMenu()`; added `setWindowControls()`; added debounced `updateAddressSuggestions()`/`fetchAddressSuggestions()` querying real bookmark/history data |
| `src/ui/components/content-renderer/content-renderer.ts` | Added `setContextMenuHandler()` and a real `contextmenu` listener on the canvas |
| `src/ui/components/address-bar/address-bar.view.ts` | `setNavigationCallbacks()` gained `onInput`; the existing `input` listener now calls it |
| `src/app/main.ts` | Wires `page.setWindowControls(...)` from the already-registered DI singleton |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-09-12-shortcuts-context-menu-autocomplete.md` | This document |

## Test Results
```
npx tsc --noEmit -p .                                            → 0 errors (repo-wide)
npx vitest run                                                    → 222 files / 9216 tests passed
npx playwright test --config=playwright-electron.config.cjs       → 7/7 passed
  (electron-smoke, fidelity-audit, keep-alive, plus four scratch
   fixtures used to verify this session's fixes, since deleted)
```

## Verification Steps
1. Pressed Ctrl+T twice and confirmed the real tab count went 1→2→3 (via DOM inspection of `.tab-bar-inner > .tab`), then Ctrl+W and confirmed it dropped back to 2.
2. Right-clicked a real rendered page and confirmed a menu appears with working Back (disabled, no history yet)/Forward (disabled)/Reload — screenshotted.
3. Navigated to a page, cleared the address bar, and typed a distinctive substring of that URL; confirmed a real suggestion (the actual visited URL, from history) appeared in the dropdown within the debounce window — screenshotted.
4. Pressed F11 twice and confirmed no thrown errors or console errors, while flagging (see Notes) that automated verification of the actual OS-level fullscreen transition was inconclusive.
