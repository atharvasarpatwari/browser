# Custom New-Tab Page

**Date:** 2026-08-19
**Session:** Created branded new-tab page with search bar and quick links
**Status:** Completed

---

## Summary

Replaced the default blank `about:blank` home page with a branded `nova://newtab` page featuring a search bar, quick-link tiles, and the Nova Browser identity. The page resolves the "blank screen" issue on app launch.

## Files Created

| File | Purpose |
|------|---------|
| `src/ui/pages/new-tab-page.ts` | NewTabPage class — branded page with search bar + quick links |

## Files Modified

| File | Change |
|------|--------|
| `src/browser/navigation/router.ts` | Added `['nova://newtab', 'newtab', 'New Tab']` to `internalPages` array |
| `src/browser/navigation/url-parser.ts` | Added `'nova://newtab': 'about:newtab'` to `SPECIAL_PAGES` map |
| `src/ui/pages/browser-window.ts` | Added `NewTabPage` import, `activeNewTabPage` field, `case 'about:newtab'/'nova://newtab'` in `renderSpecialPage()`, `renderNewTabPage()` method, `cleanupNewTabPage()` |
| `src/app/app-shell.ts` | Changed `homePage: 'about:blank'` → `'about:newtab'` |
| `src/browser/settings/startup-pages.ts` | Changed new-tab startup URL from `'about:blank'` → `'about:newtab'` |
| `src/ui/pages/settings-page.ts` | Changed default `homePage` setting from `'about:blank'` → `'about:newtab'` |
| `tests/settings-page.test.ts` | Updated 2 assertions: `'about:blank'` → `'about:newtab'` |
| `tests/settings-features.test.ts` | Updated 1 assertion: `'about:blank'` → `'about:newtab'` |

## Design

The new-tab page features:
- Dark gradient background (`#0f0c29` → `#1a1a2e` → `#16213e`)
- Nova Browser sparkle logo + branding + "Private · Fast · Secure" tagline
- Glassmorphism search bar with focus animation
- 5 quick-link tiles: Settings, Downloads, Bookmarks, History, Extensions
- Date/time display in footer
- Search bar detects URLs vs search queries (configurable engine via settings)
- Event bus pattern: emits `navigate(url)` events for BrowserWindow to handle

## Test Results

```
Tests  131 passed (131)
```

All settings-page and settings-features tests updated and passing.

## Verification

1. `npx vitest run tests/settings-page.test.ts tests/settings-features.test.ts` — 131/131 passed
2. `npm run build:web` — built in 1.09s
3. `npx cap sync android` — synced
4. Android APK assembled, installed, launched — new-tab page renders with search bar and quick links
