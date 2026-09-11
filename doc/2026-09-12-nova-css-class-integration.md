# Nova-* CSS Class Integration — Chrome Wired to the Design System

**Date:** 2026-09-12
**Session:** Wired the browser chrome (toolbar, address bar, tab strip, status bar, bookmark bar) to the `.nova-*` component class system that `styles.css` already ships, closing the gap the 2026-09-10 design-mockup session flagged.
**Status:** Completed

---

## Summary
The 2026-09-10 design-mockup session (`2026-09-10-browser-interface-design-mockup.md`) found two parallel UI styling systems coexisting in the source tree: `styles.css` already defines a full `.nova-*` component class library (`.nova-navbar`, `.nova-addressbar`, `.nova-tab`, `.nova-statusbar`, `.nova-bookbar`, etc.) with real hover/active/disabled states, matching the published Nova Browser Interface mockup — but nothing in `src/ui/components/` referenced those classes. The five chrome `.view.ts` files instead built their DOM with inline `style.cssText` against `themes.ts`'s older, smaller CSS-variable set.

This session rewired `toolbar.view.ts`, `address-bar.view.ts`, `tab-strip.view.ts`, `status-bar.view.ts`, and `bookmark-bar.view.ts` to render with the existing `.nova-*` classes instead of hand-rolled inline styles, which also let a fair amount of manual hover/disabled/pinned-state JS be deleted now that the CSS pseudo-classes (`.nova-nav-btn:hover:not(:disabled)`, `.nova-tab.pinned`, `.nova-dropdown-item--selected`, etc.) do that work natively. Two e2e specs (`electron-smoke.spec.ts`, `fidelity-audit.spec.ts`) that hardcoded the old `.address-bar`/`.address-input` selectors were updated to match.

Verified live in the running Electron app (dev server + real `electron.exe` launch via Playwright's `_electron`, not just unit tests): all five bars mount with the correct classes, nav buttons compute to the spec's 32×32 circular pills, the address bar computes to a full pill at 34px height, tabs get the correct 8px rounded-top corners, native `:disabled` styling replaces the old manual back/forward greying, and the light/dark `prefers-color-scheme` split cascades consistently across the new tokens in both directions.

## Root Causes
None — this was a wiring/refactor session (existing CSS system connected to existing components), not a bug fix. One **pre-existing, unrelated** test failure was found and confirmed (not introduced by this change): `tests/android-native-bridge.test.ts`'s MobileLayout phone-viewport test already failed on unmodified `main` — `AddressBarView`/`StatusBarView` overwrite the mobile layout's own `.mobile-address-bar`/`.mobile-status-bar` wrapper `className` on attach, in both the old and new code. Confirmed via `git stash` + rerun against the original files before restoring. Left unfixed as out of scope for this session.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/components/toolbar/toolbar.view.ts` | Renders with `.nova-navbar`/`.nova-nav-btn`/`.nova-wc*` instead of `.title-bar`/`.nav-btn`/`.addr-btn` inline styles; deleted manual hover/disabled JS now handled by CSS. |
| `src/ui/components/address-bar/address-bar.view.ts` | Renders with `.nova-addressbar`/`.nova-addressbar-input`/`.nova-security`/`.nova-dropdown(-item)`; added a `focused` class toggle for `.nova-addressbar.focused`. |
| `src/ui/components/tab-strip/tab-strip.view.ts` | Renders with `.nova-tabbar`/`.nova-tabs-list`/`.nova-tabs-scroll`/`.nova-tab(-favicon/-title/-close)`/`.nova-new-tab`; deleted manual pinned/active inline-style toggling now covered by `.nova-tab.pinned`/`.nova-tab.active` CSS. |
| `src/ui/components/status-bar/status-bar.view.ts` | Renders with `.nova-statusbar`/`.nova-statusbar-right`/`.nova-statusbar-item`/`.nova-addrbar-btn`. |
| `src/ui/components/bookmark-bar/bookmark-bar.view.ts` | Renders with `.nova-bookbar`/`.nova-bk-item`/`.nova-bk-folder`; reused `.nova-new-tab` for the back/add icon buttons and `.nova-toolbar-divider` for the item separator instead of one-off inline styles. |
| `tests/e2e/electron-smoke.spec.ts` | Selectors updated: `.address-bar`→`.nova-addressbar`, `.address-input`→`.nova-addressbar-input`. |
| `tests/e2e/fidelity-audit.spec.ts` | Selector updated: `.address-input`→`.nova-addressbar-input`. |

## Files Created
None (this changelog and its analytics-dashboard companion registered separately below).

## Test Results
```
tsc --noEmit                 -> 0 errors
vitest run (full suite)      -> 9178/9179 passing
                                 (1 failure is the pre-existing MobileLayout
                                 bug above, confirmed present on unmodified
                                 main via stash-and-rerun)
Live Electron verification   -> .nova-navbar/.nova-addressbar/.nova-addressbar-input/
                                 .nova-tabbar/.nova-tab/.nova-bookbar/.nova-statusbar
                                 all present; 5 .nova-nav-btn elements;
                                 nav-btn computed 32x32px radius 9999px;
                                 addressbar computed radius 9999px height 34px;
                                 tab computed radius 8px 8px 0 0;
                                 back/forward correctly .disabled on the initial tab;
                                 prefers-color-scheme light and dark both verified
                                 self-consistent across --bg-base/--ob-700/--bg-tab-active.
```

## Verification Steps
1. `npx tsc --noEmit` — clean.
2. `npx vitest run` (full ~9179-test suite) — 9178 passing; the one failure reproduced identically on the unmodified baseline (`git stash` the 5 view.ts + 2 spec changes, rerun, `git stash apply` to restore) — confirmed pre-existing, not a regression.
3. Grepped `src/` and `tests/` for any other reference to the renamed class strings (`.tab-bar`, `.address-bar`, `.title-bar`, `.status-bar`, `.bookmark-bar`, `.suggestion-item`, etc.) — none found outside the two e2e specs already updated.
4. Launched the real Electron app (Vite dev server + `electron.exe` via Playwright `_electron`, run from the worktree so it reflects these changes) and drove it with a throwaway script: confirmed DOM structure, computed styles (pill radii, button sizing) match the CSS spec, disabled-state styling works, and screenshotted both a light-mode and a dark-mode launch to confirm the token cascade is self-consistent in each.
5. Committed as `1c3667e` on `worktree-nova-ui-nova-classes`, pushed to `origin`.
