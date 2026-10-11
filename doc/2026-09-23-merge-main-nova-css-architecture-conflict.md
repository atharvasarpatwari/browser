# Merging origin/main — A Real UI-Architecture Conflict Hiding Behind a Clean Merge

**Date:** 2026-09-23
**Session:** User saw PR #1 flagged with merge conflicts against `main` and asked what to do. This branch had diverged from `main` by 4 commits (`618e8f5`..`51deb72`) touching `doc/README.md`/`doc/analytics.html`, security/CORS wiring, and a UI reconciliation pass. Used the host's `sync_with_base_branch` tool to merge `main` in (git config `user.name` had to be set first), then resolved 14 conflicting files plus several problems that only surfaced after the textual conflicts were gone.
**Status:** Completed (8 root causes fixed, merge landed)

---

## Summary

The textual merge conflicts (14 files) were the easy part. Two much deeper problems only showed up after: main's `doc/analytics.html` `DOCS` array had 7 entries whose `tests`/`filesModified`/`filesCreated` numbers had drifted from what their own docs actually said, and — the real find — main's UI reconciliation pass (switching every chrome component to `.nova-*`-prefixed CSS classes) directly conflicts with a **later, deliberate decision already made on this branch**: commit `d8458e1` ("delete dead nova-* CSS, unify theme across all chrome") ripped out 1300+ lines of `.nova-*` CSS specifically because nothing in `src/ui` rendered those classes anymore, verified with the full suite and all e2e specs green. Taking main's UI changes reintroduced classes with zero CSS backing — real, visible breakage (content area collapsed to 0 height, `.address-bar`/`.address-input` didn't exist), not just a lint nit. Caught by running the full e2e suite after the merge looked clean, not by the merge itself.

## Root Causes

### 1. `createGlobalEnv`'s new trailing params collided at the same position
**File:** `src/browser/js/index.ts`
**Problem:** This branch added `cookieJar?: ICookieJar` as the 11th positional parameter; `main` independently added `corsEngine?: ICorsEngine` at the same position. `tests/security-runtime-enforcement.test.ts` (from `main`, merges in unconflicted) hardcodes `corsEngine` as the 11th positional argument.
**Fix:** Kept `corsEngine` at position 11 (matching the already-unconflicted test) and moved `cookieJar` to position 12 — its only positional caller, `page-renderer.ts`, was already being edited for this merge.

### 2. `page-renderer.ts`'s per-script `runJS()` calls diverged on a real, already-fixed bug
**File:** `src/browser/engine/page-renderer.ts`
**Problem:** `main`'s version of the 3 script-execution call sites re-passed `controller`/`resourceEnforcer`/`scriptEnforcer`/`corsEngine`/etc. into `runJS()` per script tag with no `globalEnv`, which makes `runJS` build a **fresh environment per script** (`env = globalEnv ?? createGlobalEnv(...)`). This branch already fixed that exact bug earlier (multiple `<script>` tags on one page need one shared `window`) by building `globalEnv` once and reusing it. Taking `main`'s version verbatim would have resurrected the multi-script isolation bug.
**Fix:** Kept the shared-`globalEnv` calls, and added the one thing `main`'s version had that the shared-env creation was missing — `corsEngine` — into the single `createGlobalEnv()` call that builds it.

### 3. `BrowserWindowPageConfig` was missing `hideChromeUI` entirely
**File:** `src/ui/pages/browser-window.ts`
**Problem:** `main` added a real feature — a `hideChromeUI` config flag that hides all rendered chrome (titlebar/toolbar/tabbar/bookmarkbar) for an external native shell (Android Compose) while keeping internal wiring intact — with two call sites (mobile branch, desktop branch). The mobile-branch call site merged in unconflicted; the desktop-branch one conflicted with this branch's empty diff at that hunk and was resolved by taking `main`'s version. But the interface field declaration and its `DEFAULT_PAGE_CONFIG` default never made it through git's merge at all (neither side's hunk touching that region conflicted, so git silently dropped `main`'s insertion) — 3 `tsc` errors (`Property 'hideChromeUI' does not exist`).
**Fix:** Added `readonly hideChromeUI: boolean` to the interface and `hideChromeUI: false` to the default config object.

### 4. Stale `showTrafficLights` reference in the desktop `ToolbarView` construction
**File:** `src/ui/pages/browser-window.ts`
**Problem:** A leftover comment block passed `{ showTrafficLights: !this.config.forceDesktopChrome }` into `new ToolbarView(...)` — dead as of this branch's own `d8458e1` cleanup, which moved window controls into the titlebar and dropped `showTrafficLights` from `ToolbarViewConfig` (confirmed: this config option was fully restored once the UI-architecture revert below happened, so the original call site's config param is correct again).
**Fix:** No longer applicable after Root Cause 6 restored `ToolbarViewConfig.showTrafficLights` — the original call site is correct as-is.

### 5. `doc/analytics.html`'s `DOCS` array: 7 entries had stale, un-recomputed numbers
**File:** `doc/analytics.html`
**Problem:** 7 overlapping `DOCS` entries (`2026-09-05-socket-proxy-phase4-tls-handler.md`, `2026-09-06-android-device-smoke-test.md`, `2026-09-06-android-manual-test-checklist.md`, `2026-09-06-quic-wire-correctness.md`, `2026-09-06-socket-proxy-phase5-context-isolation.md`, `2026-09-07-claude-outputs-placement-and-smoke-test.md`, `2026-09-07-roadmap-implementation.md`) existed on both branches with different `tests`/`filesModified`/`filesCreated` values. Checked each against its own doc's actual Files Modified/Created tables and Test Results section (e.g. `quic-wire-correctness.md` clearly states a baseline delta of 9185−9161=24 net-new tests; this branch's stale entry said 63, which was actually a cumulative "tests passed" count copied from the wrong line) — `main`'s numbers were correct in all 7 cases. Separately, 3 real docs already on disk (`2026-09-07-analytics-dashboard-update.md`, `2026-09-10-browser-interface-design-mockup.md`, plus 2 more 2026-09-12 docs, and `2026-09-13-security-enforcement-wiring.md`/`2026-09-14-webrtc-phase2-dtls-sctp-plan.md`) had never been registered in `DOCS` on either branch.
**Fix:** Took `main`'s ground-truth-verified values for the 7 disputed entries; added the missing entries; recomputed header/KPI fallback numbers from the merged 316-entry array (309→316 docs, 9534→9449 tests, 641→655 root causes, 1561→1652 files touched, 50→52 days).

### 6. Main's `.nova-*` CSS-class UI reconciliation conflicts with this branch's own later, deliberate removal of that exact CSS
**Files:** `src/ui/components/address-bar/address-bar.view.ts`, `toolbar.view.ts`, `bookmark-bar.view.ts`, `status-bar.view.ts`, `tab-strip/tab-strip.view.ts`, `src/ui/layout/desktop-layout.ts`
**Problem:** `main`'s `2026-09-12-nova-interface-mockup-implementation.md` session moved every chrome component to `.nova-*`-prefixed classes styled by external CSS. This branch's own commit `d8458e1` ("delete dead nova-* CSS, unify theme across all chrome", 2026-09-10 — *before* `main`'s reconciliation even in wall-clock terms, but this branch never rebased) deleted ~1100 lines of exactly that CSS, having confirmed via full-tree grep that nothing in `src/ui` rendered those classes at the time, and switched every component to self-contained inline `style.cssText`. 4 of the 6 files merged with **zero conflict markers** (git silently took `main`'s content since this branch hadn't touched those exact lines) and the other 2 conflicted and were initially resolved toward `main`'s version. Running the full e2e suite afterward caught it immediately: `.content-area` collapsed to 0 height (`.nova-content-area`'s flex-grow rule doesn't exist in `styles.css` — confirmed via `grep -c "\.nova-" styles.css` → 0), and `.address-bar`/`.address-input` didn't exist at all (6 of 7 e2e specs failed).
**Fix:** Restored all 6 files to this branch's own pre-merge content (`git show bf82657:<path> > <path>` — a clean revert, verified via `git diff` showing zero net change against the pre-merge commit for 4 of the 6). Re-applied the two small, genuinely independent fixes the merge still needed on top: `hideChromeUI`'s missing config field (Root Cause 3) and the `DesktopLayoutAreas.titleBar`/`menuBar` field-name mismatch this revert exposed (`main` renamed `menuBar`→`titleBar`; this branch's own field is still `menuBar`, so the `hideChromeUI` block's desktop-branch code was fixed to reference `areas.menuBar`).

### 7. Reverting the UI files reintroduced a real, separate bug `main` had already fixed
**Files:** `src/ui/components/address-bar/address-bar.view.ts`, `status-bar/status-bar.view.ts`
**Problem:** `AddressBarView.build()`/`StatusBarView.build()` both do `this.container.className = 'address-bar'` / `'status-bar'` — an unconditional *replace*, not an append. In the mobile layout, `MobileLayout` pre-creates the container with `className = 'mobile-address-bar'` / `'mobile-status-bar'` before handing it to `attach()`; the view's own `build()` then clobbers that class the moment it runs, which is exactly what `main`'s reconciliation doc flagged as "removed root-class overwrite" — a real, narrow, correct fix independent of the `.nova-*` CSS question. Undoing the whole UI-reconciliation revert (Root Cause 6) undid this fix too: `tests/android-native-bridge.test.ts`'s `hideChromeUI also hides MobileLayout's own chrome` test failed with `expect(statusBar).not.toBeNull()` — `container.querySelector('.mobile-status-bar')` found nothing because the class had been overwritten to `'status-bar'`.
**Fix:** Changed both call sites from `this.container.className = '...'` to `this.container.classList.add('...')` — adds the component's own class without touching whatever the container already had. `ToolbarView`/`TabStripView`/`BookmarkBarView` weren't touched since they're desktop-only in this branch's `mount()` flow (no mobile-clobbering scenario exists for them) and nothing tests it.

### 8. New test mocks didn't implement interfaces this branch had since expanded
**File:** `tests/security-runtime-enforcement.test.ts` (new from `main`)
**Problem:** The mock `IDomTree`/`ICssParser`/`IResourceLoader` objects were written against the interface shapes as of `main`'s fork point — missing `matches`/`parseFragment` (added to `IDomTree` by this branch's Sizzle-selector-engine work), `extractCss5RulesFromDocument` (added to `ICssParser`), and `setOnLoad`/`getCookieJar` (added to `IResourceLoader` by this branch's cookie-jar wiring). 3 `tsc` errors.
**Fix:** Added no-op `vi.fn()` mocks for each missing method to the 3 mock-factory functions.

## Notes

- The `sync_with_base_branch` host tool refused twice before succeeding: once because it won't touch an uncommitted working tree (the round's tokenizer/array-slice fixes were committed locally first, not pushed), once because `git config user.name` wasn't set at all (only `user.email` was) — asked the user to set it, which unblocked the merge-commit step.
- Root Cause 6 is the one worth remembering: a merge that resolves every textual conflict and typechecks clean can still ship a real regression if two branches made **opposite architectural decisions** about the same subsystem and the overlap happens to auto-merge without a conflict marker. The only thing that caught it here was running the *existing* e2e suite, unmodified, after the merge — not the merge tooling, not `tsc`, not `vitest`'s DOM-mocked component tests (which don't render real CSS layout at all).
- Explicitly did not delete or "fix" `Main-html/` (a static HTML/React export `main` added) or `finalize-session.cjs` — both merged in cleanly, unrelated to this conflict, no reason to touch them.
- The `android/app/src/main/assets/` conflicts (5 files: hashed JS bundles + `index.html`) were pure build output — resolved by removing the stale tracked copies and regenerating via `node android/scripts/copy-web.mjs` against the fresh `dist/` build, rather than attempting to hand-merge minified bundles.

## Files Modified

| File | Change |
|------|--------|
| `TODO.md` | Merge conflict resolved — kept the more recent "Last updated" date, retained the reference note |
| `doc/README.md` | Merge conflict resolved — 3 genuinely new Change Log rows from `main` inserted in chronological order |
| `doc/analytics.html` | Merge conflict resolved; 7 entries corrected to ground-truth values; 3 missing entries added; header/KPI numbers recomputed (316 docs, 9449 tests, 655 root causes, 1652 files, 52 days) |
| `src/browser/js/index.ts` | `createGlobalEnv`'s new `corsEngine`/`cookieJar` params reordered to avoid a position-11 collision |
| `src/browser/engine/page-renderer.ts` | Kept the shared-`globalEnv`-per-page architecture; threaded `corsEngine` into the one `createGlobalEnv()` call that builds it |
| `src/ui/components/address-bar/address-bar.view.ts` | Reverted to this branch's own inline-styled implementation; `className =` → `classList.add()` so a layout-owned class (`mobile-address-bar`) survives attachment |
| `src/ui/components/status-bar/status-bar.view.ts` | Same `classList.add()` fix as address-bar.view.ts |
| `src/ui/pages/browser-window.ts` | Added missing `hideChromeUI` config field + default; restored `showTrafficLights` `ToolbarView` construction; fixed `areas.titleBar`→`areas.menuBar` |
| `tests/android-native-bridge.test.ts` | Merged in from `main` unconflicted (new `hideChromeUI` test coverage) |
| `tests/security-runtime-enforcement.test.ts` | New from `main`; added missing mock methods (`matches`, `parseFragment`, `extractCss5RulesFromDocument`, `setOnLoad`, `getCookieJar`) to satisfy this branch's expanded interfaces |
| `android/app/src/main/assets/**` | Regenerated via `node android/scripts/copy-web.mjs` against the fresh merged `dist/` build |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/security/secure-context.ts` | From `main` — `isSecureContextUrl`/`isSecureContextOrigin`, unconflicted |
| `doc/2026-09-07-analytics-dashboard-update.md`, `doc/2026-09-10-browser-interface-design-mockup.md`, `doc/2026-09-12-analytics-dashboard-update.md`, `doc/2026-09-12-hn-rendering-pipeline-fixes.md`, `doc/2026-09-12-nova-interface-mockup-implementation.md`, `doc/2026-09-13-security-enforcement-wiring.md`, `doc/2026-09-14-webrtc-phase2-dtls-sctp-plan.md` | From `main`, unconflicted |
| `doc/2026-09-23-merge-main-nova-css-architecture-conflict.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 229/229 files, 9339/9339 tests passed
npm run build:web                                        → built clean
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
```

## Verification Steps

1. Fetched `origin/main`, confirmed PR #1 (`claude/ponytail-folder-browser-8b310d` → `main`) showed `mergeStateStatus: DIRTY`, `mergeable: CONFLICTING` via `gh pr view`.
2. Committed the round's already-verified uncommitted work locally (not pushed) so `sync_with_base_branch` could run against a clean tree; asked the user to set `git config --global user.name` when the tool reported it missing.
3. Ran `sync_with_base_branch`, got 14 conflicting files (none sandbox-protected).
4. Resolved `TODO.md`, `doc/README.md` (chronological reinsertion of 3 new rows), then `doc/analytics.html` — diffed the conflicting `DOCS` entries programmatically (file key → full line) and checked 7 disputed ones against their own docs' real Files Modified/Created tables and Test Results sections one at a time, rather than guessing a side.
5. Resolved the 5 source-code conflicts (`index.ts`, `page-renderer.ts` ×3, `address-bar.view.ts`, `toolbar.view.ts` ×3, `browser-window.ts`) by tracing what each side's change actually depended on (e.g. grepping for `MenuClickEvent`'s required `x`/`y` fields before accepting a menu-button rewrite that dropped them).
6. Removed the 5 conflicting Android build-artifact files and regenerated via the real pipeline.
7. `tsc --noEmit` surfaced 3 real gaps (missing `hideChromeUI` field, stale `showTrafficLights` reference, 3 missing mock methods) that the textual merge had silently introduced — fixed each with the smallest correct change.
8. `vitest run` and a full e2e run both passed. Re-ran e2e specifically because UI files were involved — caught the `.nova-*` architecture conflict (6/7 specs failing, `.content-area` at 0 height) that nothing else had flagged.
9. Traced the 0-height collapse to `.nova-content-area` having zero CSS rules in `styles.css`, then to commit `d8458e1` which deliberately deleted all `.nova-*` CSS on this branch. Reverted all 6 affected UI files to this branch's pre-merge content, re-applied only the 2 small non-UI-architecture fixes still needed on top (`hideChromeUI` field, `menuBar` field name).
10. Re-ran the full suite: this surfaced one more real regression from the revert (`android-native-bridge.test.ts`'s mobile `hideChromeUI` test) — root-caused to the container-class-clobbering bug `main` had independently fixed, resolved narrowly with `classList.add()`.
11. Final full verification (tsc, vitest 229/229, build, e2e 7/7) all green. Regenerated Android assets, staged everything.
