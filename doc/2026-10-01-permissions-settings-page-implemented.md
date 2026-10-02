# Permissions Settings Page (Phase 6h) — Grants Now Survive Reload, and Can Be Revoked

**Date:** 2026-10-01
**Session:** Next Phase 6 "smaller polish" slice after AVIF/SVG image decoding, explicitly flagged as "a good next-next candidate" by the prior session's Permissions sizing investigation (chosen over GIF animation, confirmed genuinely not small). This round went deeper than that prior sizing pass — full implementation-ready detail across both the JS-engine binding layer and the Settings UI layer — before implementing.
**Status:** Completed (1 root cause fixed)

---

## Summary

The Geolocation/Notifications/Clipboard permission-prompt UI (shipped in an earlier phase) worked, but `PermissionStore` was rebuilt from scratch on every single page load — a grant didn't survive even a reload of the same tab, and there was no way to see or revoke a granted permission anywhere in the UI. Fixed with a new `PersistentPermissionStore` (localStorage-backed, mirroring `PersistentCookieStore`'s exact existing shape in this codebase) threaded through the JS-engine permission-binding layer as a seed + write-through callback, and a real "Permissions" section added to Settings — following the same pattern the Profiles settings page already proved out for `ProfileManager`.

## Root Causes

1. **`PermissionStore` had no persistence and no enumeration method.** It held grants in a plain in-memory `Map`, constructed fresh per navigation inside `createPermissionApiBindings`, with no way to list or revoke anything. Fixed by adding `PersistentPermissionStore` (`src/browser/storage/persistent-stores.ts`) and threading it through as an optional seed `Map` + `onPersist` callback on `PermissionStore`'s constructor — the same callback-injection pattern already used for `promptUser`, keeping `PermissionStore` itself ignorant of `Storage`/localStorage. The seed only includes the current page's own origin (the only one this `PermissionStore` instance will ever query), not the whole persisted store.

## Notes

- **Honest, documented known limitation, not fixed here**: revoking a permission from Settings does not affect an already-open tab's in-memory `PermissionStore` for that origin — it takes effect on the next navigation/reload. Live cross-tab invalidation would need a new event channel from the persisted store to every live `PermissionGatedWebApis` instance; genuinely separate, bigger work. Not independently re-verified in this session's live check (would need two real open tabs), but it follows directly from `PermissionStore`'s unchanged per-page-load construction.
- The `'list'` setting-type case in `settings-page.ts` was hardcoded to always call `buildProfileList()`, ignoring `setting.key` — confirmed by a prior session's investigation. Fixed with the smallest correct diff, a key-based branch (`if (setting.key === 'profileList') ... else if (setting.key === 'permissionList') ...`), not a generic list-renderer abstraction — two list sections don't justify that yet.
- `buildPermissionsList()` mirrors `buildProfileList()`'s exact DOM-construction idiom (raw `createElement`/`style.cssText`, `makeButton` reuse, full re-render after mutation) for consistency within the same file, and reuses the Bookmarks panel's empty-state convention (icon + descriptive text) for the "no permissions granted yet" case, since `buildProfileList()` itself has no empty-state precedent to copy.
- No new `IPersistentPermissionStore` interface — nothing else implements or mocks this store; add one only if a real test double is ever needed.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/storage/persistent-stores.ts` | New `PersistentPermissionStore` class (get/set/revoke/entries, localStorage-backed) |
| `src/browser/web-apis/web-apis-permissions.ts` | `PermissionStore` constructor gains optional `seed`/`onPersist`; `setState` writes through; `WebApisConfig`/`PermissionGatedWebApis` thread both |
| `src/browser/js/permissions-api.ts` | `createPermissionApiBindings` gains an optional `persistentStore` param, builds the origin-scoped seed and write-through callback |
| `src/browser/js/index.ts` | `createGlobalEnv` threads a new `persistentPermissionStore` param through to `createPermissionApiBindings` |
| `src/browser/engine/page-renderer.ts` | `PageRendererDependencies` gains `permissionStore`; `executeAllScripts` passes it to `createGlobalEnv` |
| `src/app/main.ts` | DI-registers `PersistentPermissionStore` (mirroring `PersistentCookieStore`'s exact pattern); resolves and wires it into both `PageRenderer`'s deps and `BrowserWindowPage` |
| `src/ui/pages/settings-page.ts` | New `permissions` section; constructor gains `permissionStore` param; `'list'` case now branches on `setting.key`; new `buildPermissionsList()` |
| `src/ui/pages/browser-window.ts` | New `permissionStore` field, `setPermissionStore()` setter (+ interface entry); threads into `SettingsPage`'s construction |

## Files Created

| File | Purpose |
|------|---------|
| `tests/settings-page-permissions.test.ts` | Real-pipeline (real `PersistentPermissionStore`, no mocks) coverage: renders granted permissions, Revoke works, empty state, graceful no-store case |
| `doc/2026-10-01-permissions-settings-page-implemented.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 240/240 files (minus 3 pre-existing, unrelated DNS-resolver failures), 9405/9405 tests (12 new)
```

The 3 failing `tests/networking-integration.test.ts` DNS-resolver cases are pre-existing and untouched by this change — the same environment condition noted in the last several changelogs.

## Verification Steps

1. Unit tests: `PersistentPermissionStore` CRUD + persistence-survives-a-new-instance (`tests/persistent-stores.test.ts`, 7 new); `SettingsPage`'s Permissions section renders/revokes/empty-states correctly against a real store (`tests/settings-page-permissions.test.ts`, 4 new); a real-pipeline test proving a page script's granted permission actually writes through to a supplied `PersistentPermissionStore`, not just that the UI can read a store someone else populated (`tests/page-renderer-permissions.test.ts`, 1 new).
2. Live dev-preview verification, full end-to-end flow: loaded a real page calling `navigator.geolocation.getCurrentPosition(...)`, clicked Allow on the real permission-bar prompt, opened `nova://settings` → Permissions, confirmed the grant appeared with the correct origin/permission/state; clicked Revoke and confirmed it disappeared, replaced by the "No permissions granted yet" empty state.
3. Ran the full suite — 0 regressions in any file this phase touched; the only failures are the 3 pre-existing, environment-dependent DNS tests noted above.
