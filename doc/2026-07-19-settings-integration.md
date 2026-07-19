# Settings/Preferences Full Integration

**Date:** 2026-07-19
**Session:** Settings persistence + service layer + router wiring
**Status:** Completed

---

## Summary

Implemented full settings integration: SettingsStore (Map + localStorage persistence), SettingsService (DI service mediating UI ↔ storage with change broadcasting), wired SettingsPage into BrowserWindowPage router, registered both in DI container. Navigation to `nova://settings` now renders the full SettingsPage UI with live persistence.

## Architecture

```
SettingsPage (UI)          SettingsService (DI)        SettingsStore (Persistence)
  ↕ settingChanged events    ↕ getValue/setValue         ↕ Map + localStorage
  └── mount/unmount          └── onChange listeners       └── load/save/reset
```

Data flow:
1. User changes a setting in SettingsPage → `settingChanged` event
2. SettingsService (subscribed) persists value to SettingsStore
3. SettingsStore auto-saves to localStorage via `STORAGE_KEY`
4. On page reload: SettingsStore loads from localStorage → SettingsService.init() pushes values into SettingsPage
5. External subsystems subscribe to `SettingsService.onChange()` to react to setting changes

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/storage/settings-store.ts` | SettingsStore — Map + localStorage persistence, load/save/reset |
| `src/browser/storage/settings-service.ts` | SettingsService — DI service, mediates UI ↔ store, change broadcasting |
| `tests/settings-store.test.ts` | 19 tests — CRUD, persistence, corrupted storage, disposal |
| `tests/settings-service.test.ts` | 20 tests — init, sync, change events, typed getters, listener management |

## Files Modified

| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | Import SettingsPage + ISettingsService; detect `nova://settings` in renderUrlContent and mount real SettingsPage; `setSettingsService()` hook; cleanup on unmount |
| `src/app/main.ts` | Import SettingsStore + SettingsService; add 2 DI tokens; register both in container; wire SettingsService → BrowserWindowPage in mountBrowserUI() |

## Key Decisions

- **Sync flag prevents infinite loops:** When SettingsService.init() calls page.setSetting() to load persisted values, the sync flag prevents re-emitting to the store
- **SettingsPage created lazily:** Only instantiated when navigating to `nova://settings`, not at mount time
- **setSettingsService hook:** BrowserWindowPage accepts SettingsService reference and automatically wires it when SettingsPage is created
- **localStorage optional:** SettingsStore works without storage (in-memory only) for tests
- **Corrupted storage handled:** JSON parse errors during load clear the store and start fresh

## Test Results

```
Test Files  2 passed (2)
     Tests  39 passed (39)

Full suite: 75 test files, 2906 tests — all passing
```

## Verification

1. SettingsStore persists to MockStorage (tests confirm localStorage integration)
2. SettingsService.init() loads stored values into mock page
3. Page changes sync back to store via settingChanged event
4. onChange listeners receive (key, value, oldValue) tuples
5. resetAll clears both store and page
6. BrowserWindowPage correctly detects nova://settings and mounts SettingsPage
7. Full suite 75/75 test files pass, 2906/2906 tests pass
