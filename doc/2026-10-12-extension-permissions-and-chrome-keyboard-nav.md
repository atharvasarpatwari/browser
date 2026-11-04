# Deferred Compliance Items — Extension Permission Prompt + Chrome Keyboard Nav/Contrast

**Date:** 2026-10-12
**Session:** Implemented the two items deferred from the 2026-10-11 compliance-checklist session: an extension install-time permission prompt, and keyboard navigation + color contrast for Nova's own browser chrome (tab strip, bookmark bar)
**Status:** Completed

---

## Summary

Two Explore passes first established the real starting state, which changed scope from what was assumed when these items were deferred: the entire `src/browser/extensions/` subsystem (loader, permissions, manifest parser) was dead code with no `nova://extensions` page at all, and no modal/dialog component existed anywhere in `src/ui`. Chrome keyboard support existed only in the address bar; the tab strip and bookmark bar were mouse/drag-only `<div>`s with no `tabindex`. Both gaps are now built — reusing the extensions subsystem's existing (already-tested-in-isolation) `Permissions`/`ExtensionLoader` classes rather than writing new business logic, and following the existing WAI-ARIA tabs pattern for the tab strip.

## Part A — Extension permission prompt

### Root cause / starting state
`nova://extensions` was registered as a route (`router.ts`) but `browser-window.ts` never built a page for it. `ExtensionLoader`/`Permissions` (`src/browser/extensions/`) were fully implemented and unit-testable in isolation but had zero importers anywhere — confirmed dead code, also flagged in the 2026-10-11 ponytail-audit (`TODO.md` §5a).

### What was built
- **`src/app/main.ts`**: registered `ExtensionLoader`/`Permissions` as DI singletons (`Tokens.ExtensionLoader`, `Tokens.ExtensionPermissions`), resolved and wired into the page alongside the other services.
- **`src/ui/components/permission-dialog.ts`** (new): a small, one-off confirm dialog (title + permission list + Allow/Deny), matching the inline-styled-DOM convention `settings-page.ts`/`research-page.ts` already use. Not a generic Modal framework.
- **`src/ui/pages/extensions-page.ts`** (new): lists installed extensions via `ExtensionLoader.getAllExtensions()` (enable/disable/uninstall), plus an "Install extension" flow — paste a `manifest.json`, preview it via the already-exported `createExtensionFromManifest()` (id + declared `permissions`/`host_permissions`), show the permission dialog, and only call `permissions.grant()` + `loader.loadFromManifest()` on Allow.
- **`src/ui/pages/browser-window.ts`**: `renderExtensionsPanel()` + `case 'nova://extensions':`, mirroring `renderResearchPanel()`/`renderSettingsPanel()` exactly; `setExtensions()` setter + cleanup wiring.

### Bug caught while implementing
`ExtensionLoader.getEnabledExtensions()` filters to enabled-only — using it for the extensions list would have made a disabled extension vanish entirely instead of showing with an "Enable" button. Used `getAllExtensions()` instead.

## Part B — Chrome keyboard navigation + contrast

### Root cause / starting state
Tab strip and bookmark bar items were plain `<div>`s with mouse/drag handlers only — no `tabindex`, no `role`, no keydown. `aria-selected` was already present on tabs but with nothing to make them reachable by keyboard. `--tx-tertiary` (`rgba(255,255,255,.32)`, used for tab-close/new-tab icons) computed to ~2.9:1 against the tab background — under the WCAG 1.4.11 non-text 3:1 minimum. The light-theme override (`rgba(0,0,0,.36)`) was found to be *worse* (~2.5:1) once checked. `enableKeyboardShortcuts` in Settings was a dead toggle wired to nothing.

### What was built
- **`src/ui/components/tab-strip/tab-strip.view.ts`**: `role="tablist"` on the container, `role="tab"` + roving `tabindex` (0 for the active tab, -1 for the rest) on each tab. Standard WAI-ARIA tabs keyboard pattern: ArrowLeft/Right move-and-switch (wrapping), Home/End jump to first/last, Enter/Space select — automatic-activation model, matching how real browser tab strips already behave (not a manual-activation model, which would've needed extra focus-tracking state for no real benefit here).
- **`src/ui/components/bookmark-bar/bookmark-bar.view.ts`**: simpler flat treatment — `role="button"` + `tabindex="0"` + Enter/Space on each bookmark/folder item. No arrow-key grouping (deliberately out of scope — a flat list doesn't need a roving `tablist`).
- Both gated behind the `enableKeyboardShortcuts` setting — wired live via `ISettingsService.onChange()` in `browser-window.ts`'s `setSettingsService()`, giving that setting a real purpose for the first time instead of leaving it as another orphaned toggle.
- **`styles.css`**: bumped `--tx-tertiary` from `.32`→`.40` (dark) and `.36`→`.44` (light `prefers-color-scheme` override) — computed to ~3.8:1 and ~3.2:1 respectively against their worst-case chrome backgrounds, clearing the 3:1 floor with margin. Single shared token, every consumer (both tab-strip icons and ~15 other UI uses of the same token) gets the fix at once.

### Bug caught while implementing
The planned roving-tabindex-via-`queueMicrotask`-refocus approach was dropped in favor of focusing the target tab element directly and synchronously: every tab's DOM element already exists regardless of active state (only styling/attributes differ), so there's no need to wait for a re-render to move focus — sidestepping an unverified assumption about whether `tabSelected` → `activateTab` → re-render happens synchronously.

## Files Modified
| File | Change |
|------|--------|
| `src/app/main.ts` | DI registration for `ExtensionLoader`/`Permissions`, wired into page |
| `src/browser/navigation/router.ts` | `nova://extensions` already routed; no change needed beyond what's already there |
| `src/ui/pages/browser-window.ts` | `renderExtensionsPanel()`, `setExtensions()`, keyboard-nav wiring in `setSettingsService()` |
| `src/ui/components/tab-strip/tab-strip.view.ts` | `role="tablist"`/`role="tab"`, roving tabindex, keydown handler, `setKeyboardNavEnabled()` |
| `src/ui/components/bookmark-bar/bookmark-bar.view.ts` | `role="button"`/`tabindex`, keydown handlers, `setKeyboardNavEnabled()` |
| `styles.css` | `--tx-tertiary` contrast fix (dark + light theme overrides) |
| `tests/android-native-bridge.test.ts` | Fixed a partial `ISettingsService` test mock that broke once `setSettingsService()` started calling `getBoolean`/`onChange` |

## Files Created
| File | Purpose |
|------|---------|
| `src/ui/components/permission-dialog.ts` | One-off Allow/Deny permission confirm dialog |
| `src/ui/pages/extensions-page.ts` | `nova://extensions` page: list + install flow |
| `tests/extensions-page.test.ts` | 6 tests: empty state, permission list preview, Deny, Allow+grant+install, invalid-manifest error, Disable |
| `tests/tab-strip-view.test.ts` | 7 tests: tablist/tab roles, roving tabindex, ArrowRight/Left (incl. wrap), Home/End, Enter/Space, disabled-gating |
| `tests/bookmark-bar-view.test.ts` | 5 tests: focusable role=button items, Enter/Space activation for bookmarks and folders, disabled-gating, ignored keys |
| `.claude/launch.json` | Vite dev-server launch config for live browser-pane verification |

## Test Results
```
npx tsc --noEmit                                           # 0 errors
npx eslint <all changed/new files>                          # 0 errors, pre-existing warnings only
npx vitest run (targeted: extensions/tab-strip/bookmark-bar) # 18/18 new tests passed
npx vitest run (full suite, 1st pass)                        # 220/221 files — 1 failure (the pre-existing
                                                               partial-mock test above), 9222/9223 tests
npx vitest run (full suite, after the mock fix)              # 221/221 files, 9223/9223 tests, exit 0
```

## Verification Steps

1. `npx tsc --noEmit` — clean, 0 errors, after both Part A and Part B.
2. `npx eslint` on every changed/created file — 0 errors.
3. Live verification via `npm run dev` (Vite) in the browser pane, desktop viewport:
   - Opened 3 tabs, confirmed `role="tablist"`/`role="tab"` and roving `tabindex` (active=0, rest=-1) via direct DOM inspection.
   - Fired a real `ArrowLeft` `KeyboardEvent` on the focused (3rd) tab — confirmed it switched to and roved tabindex onto the correct (2nd) tab, end-to-end through the real event-handler wiring (not just the unit test's simulated wiring).
   - Confirmed the computed style of a real tab-close icon is exactly `rgba(255,255,255,0.4)`, matching the new `--tx-tertiary` token.
   - `nova://extensions` and (as a control) the untouched `nova://settings` both rendered blank in this `vite`-only dev-preview environment — confirmed this is a pre-existing internal-page-navigation limitation of running outside the full Electron shell, not a regression, since the untouched `nova://settings` reproduces identically. Relied on the 6 passing `extensions-page.test.ts` tests (which drive the page directly, not through navigation) for that page's correctness instead.
   - Bookmark bar had no seeded bookmarks in this fresh dev session to click-test live; relied on its 5 passing automated tests.
4. Full `npx vitest run` — 221/221 files, 9223/9223 tests, exit 0.
