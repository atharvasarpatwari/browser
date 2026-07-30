# Settings Page Features

**Date:** 2026-07-28
**Session:** Implementing Settings Page — Themes, Profiles, Sync, Incognito, Guest, Session Restore, Startup Pages
**Status:** Completed

---

## Summary

Implemented 7 settings modules with full interfaces, implementations, factory functions, and comprehensive tests (115 tests). Fixed 4 bugs discovered during testing.

## Features Implemented

### 1. Themes (`src/browser/settings/themes.ts`)
- `ThemeManager` — manages light/dark/system/custom themes
- CSS variable injection via `:root{...}` with `data-theme` attribute
- System theme detection via `prefers-color-scheme` media query
- Custom theme add/remove, accent color override
- Event system: `themeChanged`, `modeChanged`, `customThemeAdded`, `customThemeRemoved`
- Factory: `createThemeManager(config?)`

### 2. Profiles (`src/browser/settings/profiles.ts`)
- `ProfileManager` — multi-profile support with data isolation
- Default profile always exists, cannot be removed
- Guest/incognito profiles cannot be removed or switched to
- Per-profile key-value data store
- Profile sorting: default first, then by last active
- Factory: `createProfileManager(config?)`

### 3. Sync (`src/browser/settings/sync.ts`)
- `SyncEngine` — cross-device sync with E2E encryption
- PBKDF2-derived encryption key, SHA-256 checksums
- Device tracking, conflict detection, resolution
- Periodic sync timer with configurable interval
- Stats: total synced, conflicts, per-data-type counts
- Factory: `createSyncEngine(config?)`

### 4. Incognito Mode (`src/browser/settings/incognito.ts`)
- `IncognitoManager` — ephemeral browsing sessions
- Cookie/tracker blocking toggles, session stats
- No data persistence; clear ephemeral data on deactivate
- Event system: `activated`, `deactivated`, `sessionStarted`, `sessionEnded`
- Factory: `createIncognitoManager(config?)`

### 5. Guest Mode (`src/browser/settings/guest.ts`)
- `GuestManager` — temporary browsing sessions with configurable limits
- Tab limits, download/bookmark permissions
- Session summary on deactivation (tabs opened, pages visited, downloads)
- Event system: `activated`, `deactivated`, `sessionStarted`, `sessionEnded`
- Factory: `createGuestManager(config?)`

### 6. Session Restore (`src/browser/settings/session-restore.ts`)
- `SessionRestore` — save/restore tabs and windows
- Restore policies: always, ask, never
- Max session age expiry, max tabs to restore
- Scroll position tracking per tab
- Event system: `sessionSaved`, `sessionRestored`, `sessionDiscarded`
- Factory: `createSessionRestore(config?)`

### 7. Startup Pages (`src/browser/settings/startup-pages.ts`)
- `StartupPages` — configurable startup behavior
- 4 actions: new-tab, last-session, specific-pages, continue-where-left
- Page management: add, remove, update, reorder
- Title auto-extraction from URL hostname
- Factory: `createStartupPages(config?)`

## Root Causes

### 1. ThemeManager events after dispose
**File:** `src/browser/settings/themes.ts`
**Problem:** `emit()` didn't check `disposed` flag — events still fired after dispose
**Fix:** Added `if (this.disposed) return;` at start of `emit()`

### 2. SyncEngine deviceCount in getStats
**File:** `tests/settings-features.test.ts`
**Problem:** Test expected `deviceCount: 1` but `devices` array is empty until sync registers remote devices
**Fix:** Changed test expectation to `expect(s.deviceCount).toBe(0)`

### 3. StartupPages extractTitle for empty-hostname URLs
**File:** `src/browser/settings/startup-pages.ts`
**Problem:** `new URL('about:blank')` succeeds in Node.js with empty `hostname`, so fallback to raw URL never triggered
**Fix:** Added `|| url` fallback when `parsed.hostname` is empty

### 4. StartupPages reorderPage unstable sort
**File:** `src/browser/settings/startup-pages.ts`
**Problem:** `reorderPage` set position then re-normalized via sort, but sort is unstable for equal positions — reordered page ended up after the displaced page
**Fix:** Rewrote to use splice-based reorder: remove from old position, insert at clamped new position, then normalize indices

## Files Modified
| File | Change |
|------|--------|
| `src/browser/settings/themes.ts` | Added `disposed` guard in `emit()` and `onEvent()` |
| `src/browser/settings/startup-pages.ts` | Fixed `extractTitle` empty hostname; rewrote `reorderPage` with splice |
| `tests/settings-features.test.ts` | Fixed `deviceCount` expectation from 1 to 0 |

## Files Created
| File | Purpose |
|------|---------|
| `src/browser/settings/themes.ts` | Theme engine (dark/light/custom themes) |
| `src/browser/settings/profiles.ts` | Multi-profile support |
| `src/browser/settings/sync.ts` | Cross-device sync engine |
| `src/browser/settings/incognito.ts` | Incognito mode manager |
| `src/browser/settings/guest.ts` | Guest mode manager |
| `src/browser/settings/session-restore.ts` | Session restore manager |
| `src/browser/settings/startup-pages.ts` | Startup pages configurator |
| `tests/settings-features.test.ts` | Tests for all 7 features |
| `doc/2026-07-28-settings-features.md` | This document |

## Test Results
```
 ✓ tests/settings-features.test.ts (115 tests) 80ms
 Test Files  1 passed (1)
      Tests  115 passed (115)
```
