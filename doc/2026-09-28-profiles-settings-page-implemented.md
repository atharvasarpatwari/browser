# Profiles Settings Page (Phase 5a) — A Complete Backend Sitting With Zero Wiring

**Date:** 2026-09-28
**Session:** Next roadmap slice after Forms (Phase 2/2d) and Permission-Prompt UI (Phase 3). Investigation compared Settings pages against Video/Audio real playback; Settings won as the smaller, more surgical next phase (Video/Audio remains a full phase with an unsolved occlusion/clipping design question).
**Status:** Completed (1 root cause fixed)

---

## Summary

Of the 9 settings categories the original audit flagged as "backend exists, no UI," **Profiles** was the cleanest next slice: `ProfileManager` (`src/browser/settings/profiles.ts`) is a complete, already-tested (18 passing unit tests) implementation — create/remove/switch/rename profiles, `readonly Profile[]` listing sorted default-first — with **zero production importers** anywhere. Not DI-registered, never instantiated, completely disconnected from the real `SettingsPage` UI that already existed in shape but had no mechanism for anything beyond a flat key→primitive-value setting (`type: 'text'|'number'|'boolean'|'select'|'range'`, no way to render a managed list of items with per-row actions).

This session added the missing UI mechanism (a new `'list'` setting type) and the missing DI wiring, copied exactly from the already-working `IncognitoManager` pattern. Live-verified end to end in the dev preview: created a "Work" profile via the new inline form, switched the Active badge to it, removed it, and confirmed the browser correctly fell back to the Default profile automatically — matching `ProfileManager.removeProfile()`'s own existing business rule.

**Honest scope note**: switching profiles only changes which `Profile` object is "active" and fires an event — it does not rewire `BookmarkService`/`HistoryService`/`CookieJar`/`SettingsStore` to be profile-scoped. This page makes profile management itself fully real and visible; it does not make the rest of the browser chrome show different bookmarks/history/cookies per profile. That's a separate, much larger feature (profile-scoped data isolation across every store), not attempted here.

## Root Causes

1. **`SettingsPage` had no mechanism for anything beyond a flat key→primitive-value setting, so a complete, well-tested backend (`ProfileManager`) had nowhere to plug in.** Every existing setting type (`text`/`boolean`/`select`/`range`) reads/writes a single value in a `Map<string, unknown>`; there was no concept of a setting backed by a live, managed collection with its own create/switch/remove actions. Fixed by adding a `'list'` setting type whose `case` in `render()`'s switch ignores the flat-value model entirely and reads live from a `ProfileManager` reference instead — passed in via a new second constructor parameter (`new SettingsPage(sections?, profileManager?)`), not a post-mount setter, since rendering a list just needs to *read* state at render time (unlike `SettingsService`, which needs to *subscribe* to change events after mount — a different problem shape, not one to copy 1:1 speculatively). Wired `ProfileManager` through DI exactly like the existing `IncognitoManager` singleton: `main.ts` gained an import, a `Tokens.ProfileManager` symbol, a `ServiceLifetime.Singleton` registration, and a resolve-and-hand-to-`BrowserWindowPage` call; `browser-window.ts` gained a `profileManager` field and a `setProfileManager()` setter, threaded into `SettingsPage`'s construction in `renderSettingsPanel()`.

## Notes

- Per-row rendering (avatar circle colored by the profile's `ProfileColor`, name, an "Active" badge or a "Switch" button, a "Remove" button, plus an inline name-input-and-Create-button add-profile form) follows `context-menu.ts`'s raw `createElement`/`style.cssText` convention — the same one `settings-page.ts` already uses throughout — rather than `new-tab-page.ts`'s `innerHTML`+CSS-class convention, to avoid mixing two DOM-construction idioms in one file.
- Every action (switch/remove/create) just calls the corresponding `ProfileManager` method and re-renders the whole section via the existing `render()` path — the same mechanism section-switching already uses, not a new incremental-update system.
- `removeProfile()`'s existing internal rules (cannot remove the default or guest profile, auto-falls-back to default when the active profile is removed) needed no new UI-side logic — the Remove button just calls it unconditionally and re-renders either way.
- The `'list'` mechanism is now available for the **Extensions** settings category too (`ExtensionLoader` has an equally complete, equally unwired API) — a small, low-risk follow-up, deliberately not bundled into this phase since it would show an empty list today (no real extension is loadable yet).

## Files Modified

| File | Change |
|------|--------|
| `src/ui/pages/settings-page.ts` | Added `'list'` setting type; new `profiles` section in `DEFAULT_SECTIONS`; constructor takes an optional `IProfileManager`; new `buildProfileList()`/`makeButton()` methods |
| `src/app/main.ts` | Registered `ProfileManager` as a DI singleton (mirroring `IncognitoManager`'s exact pattern); resolves and hands it to `BrowserWindowPage` |
| `src/ui/pages/browser-window.ts` | Added `profileManager` field, `setProfileManager()` setter (+ `IBrowserWindowPage` interface entry); passes it into `SettingsPage`'s construction |

## Files Created

| File | Purpose |
|------|--------|
| `tests/settings-page-profiles.test.ts` | Real-pipeline (real `ProfileManager`, no mocks) coverage: default profile renders, create/switch/remove all work and re-render correctly, graceful empty state with no `ProfileManager` supplied |
| `doc/2026-09-28-profiles-settings-page-implemented.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 236/236 files, 9371/9371 tests (5 new)
```

## Verification Steps

1. Real-pipeline tests (no mocks, a real `ProfileManager` instance, matching the file's own already-proven logic rather than re-testing it): default profile renders; creating "Work" via the inline form adds it to the list and to the manager; clicking Switch moves both the manager's active profile and the UI's Active badge; clicking Remove removes it from both; an unwired `SettingsPage` (no `ProfileManager` passed) renders the section without throwing and shows an empty list.
2. Live-verified in the dev preview end to end: opened `nova://settings` → Profiles, confirmed the Default profile and its Active badge; created "Work" via the real inline form and confirmed it appeared; clicked Switch and confirmed the Active badge moved to "Work" (and Default correctly gained its own Switch button); clicked Remove on "Work" and confirmed it disappeared with Default automatically becoming Active again — exactly matching `ProfileManager.removeProfile()`'s existing internal fallback rule, exercised for the first time by a real UI.
3. Ran the full suite (`npx tsc --noEmit -p .`, `npx vitest run`) after every change — 0 regressions across all 236 files / 9371 tests.
