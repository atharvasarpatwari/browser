# Page Script Execution Enabled (Nova Android v1.8)

**Date:** 2026-10-17
**Session:** "Decide and fix: page scripts are stripped before running". Plan: `2026-10-16-page-script-execution-plan.md` (approved: enable scripts, paint first, no JS toggle).
**Status:** Completed

---

## Summary

Page JavaScript now runs in the app, on desktop and Android. Before this, no page script had ever executed in production. Fixing that exposed three bugs in the script runner that would have broken real pages, and all three are fixed. Pages now paint before their scripts run, and a page's scripts share a 3 s total budget.

## Root Causes

### 1. The XSS sanitizer deleted every page script before the execution step
**File:** `src/app/main.ts`
**Problem:** `PageRenderer` was built with `sanitizer: new HtmlSanitizer()`. `render()` sanitizes at step 3b and runs `executeAllScripts` at step 5, and the default sanitizer config strips `<script>`. This came from `doc/xss-mitigations-plan.md` (commit `75f1066`, 2026-07-19), which placed the sanitizer "before script execution" with `<script>` on its strip list. That treated the page's own scripts as injected markup. Every renderer test builds `PageRenderer` without a sanitizer, so the tests exercised script execution that production never reached.
**Fix:**
```ts
sanitizer: new HtmlSanitizer({ keepScriptElements: true }),
```
Still stripped: `object/embed/applet/base/template`, all `on*` handler attributes, and `javascript:`/`data:` URLs. Script-inserted markup still goes through the tree-building sanitizer (`mutation-observer.ts`), which never touched `<script>`.

### 2. Each script ran in a fresh global environment
**File:** `src/browser/engine/page-renderer.ts`
**Problem:** Every `runJS()` call built its own `createGlobalEnv()`, so anything one script defined (a library, a config object) didn't exist for the next one.
**Fix:** One `createGlobalEnv(...)` per page, passed to every script as `globalEnv`.

### 3. External scripts were checked as inline code by CSP
**Problem:** `checkInlineScript(source)` ran for `<script src>` too. Under the very common `script-src 'self'` (no `'unsafe-inline'`), every legitimate external script would have been blocked.
**Fix:** External scripts are checked by URL with `checkExternalScript(fullUrl, origin, baseUrl)` before they're fetched. The inline check only applies to inline scripts.

### 4. CSP nonces were ignored
**Problem:** The `nonce` attribute was never passed to the inline check, so on nonce-based CSP sites every inline script would have been blocked.
**Fix:** `checkInlineScript(source, origin, baseUrl, el.attributes.get('nonce'))`.

## Changes to the pipeline
- **Paint first:** on pages that have scripts, layout → paint → `onFrameRendered()` (which raises `pageRepainted`, and the UI redraws the content canvas) happens **before** scripts run. Styles, layout and paint then re-run after. Pages without scripts keep their single paint.
- **Per-page budget:** `PAGE_SCRIPT_BUDGET_MS = 3000` (`ponytail:` constant). Scripts past it are skipped with a warning. That's on top of the interpreter's 5 s per-script limit. Upgrade path: yield and resume later instead of skipping.
- The three duplicated run loops (blocking / defer / async) are merged into one `run()` helper.

## Files Modified
| File | Change |
|------|--------|
| `src/app/main.ts` | sanitizer keeps `<script>` |
| `src/browser/engine/page-renderer.ts` | paint-first; shared page environment; external CSP by URL; nonce; per-page budget; single run helper |
| `android/app/src/main/assets/**` | engine rebuilt (`main-N2nxESVu.js`) |
| `android/app/build.gradle` | version 1.8 (code 9) |

## Files Created
| File | Purpose |
|------|--------|
| `tests/page-script-execution.test.ts` | 6 tests with the **production sanitizer config**: scripts run and share globals; paint happens before scripts; no extra paint without scripts; `on*` and `<object>` still stripped; CSP blocks a plain inline script, allows a nonce'd one and an external `'self'` script; the 3 s budget skips later scripts |
| `doc/2026-10-16-page-script-execution-plan.md` | Plan (approved) |
| `doc/2026-10-17-page-script-execution.md` | This changelog |

## Test Results
```
npx tsc --noEmit -> 0 errors
npx vitest run tests/page-script-execution.test.ts -> Tests 6 passed (6)
Regression guard: the same test with the old `new HtmlSanitizer()` config ->
  × runs inline scripts, sharing globals between scripts on the page  (1 failed | 5 skipped)

npx vite build -> main-N2nxESVu.js 1,367.70 kB (gzip 322.16 kB); copy-web.mjs -> Bridge injected
Headless boot of the Android bundle (the probe that exposed the bug), page script:
  document.cookie = "a=1; Path=/"; location.href = "https://shop.test/ran?c=" + document.cookie
  before: server hits: /account/ only; cookie calls: []
  after:  server hits: /account/  /ran?c=server%3D1
          cookie calls: [["set","https://shop.test/account/","a=1; Path=/"],["get","https://shop.test/account/"]]
          page errors: none

npx vitest run (full) -> Test Files 220 passed (220), Tests 9223 passed (9223)

npx playwright test --config=playwright-electron.config.cjs (Electron e2e, real desktop app)
  1 passed (keep-alive), 2 failed: electron-smoke + fidelity-audit time out waiting for
  '.address-bar' / '.address-input'. PRE-EXISTING and unrelated: those selectors no longer exist anywhere
  in src/ (removed by the 2026-09-12 UI rename, ae70ffc); the specs were last updated 2026-07-31.
  The failure snapshot shows the app launched and rendered its full chrome ("Search or enter URL",
  tabs, Nova Shield). Flagged as a separate task.

cd android && gradlew.bat :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug -> BUILD SUCCESSFUL in 2m 44s
aapt2: versionCode='9' versionName='1.8'; apksigner verify OK
```

## What's new in Nova 1.8 (user-facing)
- Websites' JavaScript now runs: menus, tabs, forms, logins and dynamic content that rely on scripts can work.
- Pages appear right away, and scripts upgrade them afterwards instead of holding up the first view.
- A misbehaving page can't freeze loading. Its scripts get 3 seconds in total.
- Site security policies (CSP) are applied correctly to scripts, including nonce-based ones.
