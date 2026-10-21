# Compliance Checklist Follow-Through — Security & Privacy Fixes

**Date:** 2026-10-11
**Session:** Turned a pasted generic compliance checklist into 4 implementable, codebase-grounded fixes (items dropped as not applicable: refund/cookie policies, dark patterns, fake reviews, email unsubscribe, licensed assets, kid's-data consent, business details — none apply to a local browser engine with no accounts/commerce)
**Status:** Completed

---

## Summary

Audited the pasted compliance checklist against the actual Nova Browser codebase (not assumptions) and implemented the 4 items the user selected: encrypt the Anthropic API key at rest, disclose that AI Research queries leave the device, add a `nova://privacy` page, and wire up a real "Clear browsing data" action (previously just a dead settings toggle).

## Root Causes (pre-existing gaps found by reading the code)

### 1. Anthropic API key stored in plaintext
**File:** `src/browser/storage/settings-store.ts`, `src/ui/pages/settings-page.ts`
**Problem:** The key was declared as a `type: 'text'` setting (line 84), rendered as a plain unmasked `<input type="text">`, and persisted as part of one unencrypted JSON blob (`localStorage['nova-settings']`).
**Fix:** New `type: 'password'` setting type (masked input). New Electron main-process module `electron/secure-store.cjs` wraps `safeStorage.encryptString`/`decryptString` behind `ipcMain.handle('nova:secure-storage')`, exposed to the renderer via `electron/preload.cjs` as `window.nova.secureStorage`. New `src/browser/storage/secure-value.ts` calls that bridge and falls back to passing the value through unencrypted outside Electron (no OS keychain to call — documented as a `ponytail:` limitation in the file). `SettingsService` now encrypts on write and decrypts on load specifically for `anthropicApiKey` (the one key in a new `SECRET_KEYS` set).

### 2. No disclosure that AI Research sends data to Anthropic
**File:** `src/ui/pages/settings-page.ts`
**Problem:** The "AI Research" settings section never told the user that submitting a query sends it to Anthropic's API.
**Fix:** Extended the API key field's description with a one-line disclosure, and added a dedicated `nova://privacy` page (see below) spelling out exactly what leaves the device and what stays local.

### 3. No privacy policy surface
**Problem:** Nothing in the app told a user what Nova does and doesn't collect.
**Fix:** Added `nova://privacy` following the exact pattern of the existing `nova://research` internal page — one router entry, one `renderHtml()` call with a static summary (local-only history/settings, AI Research's one external call, extensions' permission-scoped access).

### 4. "Delete browsing data" was a non-functional menu toggle
**File:** `src/ui/pages/settings-page.ts` (`menuShowClearData` setting)
**Problem:** The only "Delete browsing data" setting in the whole schema controlled whether a menu *item* was shown — it had zero wiring to actually delete anything. `IHistoryService.deleteAll()` already existed and was never called from Settings.
**Fix:** Added a real `type: 'action'` setting ("Clear browsing data" under Privacy & Security) that emits a new `actionTriggered` event; `SettingsService` now accepts an injected `IHistoryService` (`setHistoryService()`, wired from `src/app/main.ts` using the already-resolved instance) and calls `deleteAll()` on click. Scoped honestly to history only — cookies/per-origin storage aren't DI-reachable from Settings yet, so the action doesn't claim to clear them.

## Bug introduced and fixed during this session

Making `ResearchService`'s `apiKeyProvider` async (needed so `getSecretString()` can decrypt via the Electron IPC round-trip) moved `this.abortController = new AbortController()` to *after* an `await` point. `tests/research-service.test.ts`'s cancellation test calls `service.cancel()` synchronously right after invoking `research()`, relying on the abort controller already existing by then (JS runs an async function's body synchronously up to its first `await`). The shifted await meant `cancel()` hit a stale/null controller, so the request ran to completion instead of aborting, and the test got the mock HTTP client's generic "Aborted" error instead of the service's own "Research cancelled." — a real race, not a flaky test.
**Fix:** moved `this.abortController = new AbortController()` and the `signal` capture to *before* the `await this.apiKeyProvider()` call, with an explicit `signal.aborted` check right after the await so a cancellation that lands during key lookup is still handled correctly.

## Files Modified

| File | Change |
|------|--------|
| `electron/main.cjs` | Require + init/dispose `secure-store.cjs` alongside the existing `socket-owner.cjs` lifecycle |
| `electron/preload.cjs` | Expose `window.nova.secureStorage.{encrypt,decrypt}` |
| `src/app/main.ts` | `apiKeyProvider` now async via `getSecretString()`; wire `settingsService.setHistoryService(historyServiceInstance)` |
| `src/browser/navigation/router.ts` | Registered `nova://privacy` internal route |
| `src/browser/research/research-service.ts` | `apiKeyProvider` type allows `Promise<string\|null>`; fixed abort-controller-before-await ordering (see bug above) |
| `src/browser/storage/settings-service.ts` | `SECRET_KEYS` encrypt/decrypt on persist/load, `getSecretString()`, `setHistoryService()`, `clearBrowsingData()`, `actionTriggered` wiring, kind-guard on the `settingChanged` handler |
| `src/ui/pages/settings-page.ts` | New `password`/`action` setting types + renderers, `actionLabel` field, new Privacy & Security actions, API key field now masked with disclosure text |
| `src/ui/pages/browser-window.ts` | `nova://privacy` render case + static `PRIVACY_POLICY_HTML`, `actionTriggered` → navigate wiring for the Privacy Policy button |

## Files Created

| File | Purpose |
|------|--------|
| `electron/secure-store.cjs` | Main-process `safeStorage` encrypt/decrypt behind `ipcMain.handle('nova:secure-storage')` |
| `src/browser/storage/secure-value.ts` | Renderer-side `encryptSecret`/`decryptSecret`, calls the Electron bridge, passes through unchanged elsewhere |
| `tests/secure-value.test.ts` | 4 tests: passthrough without a bridge, idempotent decrypt of plaintext, empty-string no-op, full round-trip through a fake bridge |

## Test Results

```
npx tsc --noEmit                                                          # 0 errors
npx eslint <all changed/new files>                                        # 0 errors, 7 pre-existing warnings (unrelated lines)
npx vitest run tests/settings-service.test.ts tests/settings-page.test.ts
  tests/research-service.test.ts tests/research-page.test.ts
  tests/test-suite-comprehensive.test.ts tests/secure-value.test.ts        # 234/234 passed
npx vitest run                                                             # 218/218 files, 9205/9205 tests passed (exit 0)
```

## Verification Steps

1. `npx tsc --noEmit` — clean, 0 errors.
2. `npx eslint` on every changed/created file — 0 errors.
3. Targeted suites covering every touched module (settings service/page, research service/page, router internal-page matching, new secure-value tests) — all green, including the research-service cancellation test that caught the async-ordering regression above.
4. Full `npx vitest run` across the repo as a final check for anything the targeted suites didn't cover — 218/218 files, 9205/9205 tests, exit code 0 (only the pre-existing happy-dom teardown AbortError noise in stderr, unrelated to any test outcome).
5. Dropped scope honestly where it wasn't DI-reachable (cookie/site-storage clearing, extension permission-prompt UI, chrome-shell keyboard nav/contrast) rather than building a button that claims to do more than it does — flagged as follow-up, not silently shipped half-done.

## Addendum — `doc/analytics.html` functional-style refactor

Later in the same session: converted the dashboard's imperative DOCS-array aggregation code to map/reduce ("morphism") style, replacing `for`/`while` loops and `forEach`-with-external-mutable-accumulator patterns with pure `.reduce()`/`.findIndex()` expressions. Converted 12 spots: category/date/status tallies (`cats`, `dateCounts`, `statusCounts`, `dayStats`), two running-total "scan" patterns (`cumData`, the completion-rate sparkline) that mutated outer `let` variables inside `.map()`, the longest-active-day-streak computation (insights + achievements, two separate copies), the Pareto 80% break-loop (→ `findIndex`), the changelog category-breakdown tally, and the two string-hash functions (`fakeHash`, `fakeMinutesOfDay`).

Deliberately left imperative: DOM-manipulation `forEach` calls (pagination, confetti, scroll-reveal, column visibility), the calendar-grid date-walker (`while` loop mutating a `Date` cursor to build week rows + month labels — a stateful unfold risky to convert without the file having any automated tests), and markdown-export string building. None of these are DOCS data aggregation — forcing them into map/reduce would be style for its own sake, not a readability or correctness win.

**Verification:** no test suite covers this standalone dashboard file (it isn't part of the TS/vitest build), so verification was: (1) `node --check` on the extracted inline `<script>` — passes; (2) loaded the live page in a browser and diffed every computed output against the pre-refactor page — all KPI numbers (257/9,293/482/1,369), insights text ("Longest streak... 18 days", the Pareto "57 documents... 80%" line), achievement badges, the calendar heat-strip per-day figures, and the changelog category breakdown (`feat (50) new (26) fix (125) test (20) docs (13) plan (23)`) matched exactly; (3) checked the browser console — no errors.

## Addendum 2 — de-duplicated repeated DOCS scans (`docsByDate` / `docsByCategory`)

Found 17 separate call sites (11 filtering by date, 6 by category) each independently re-scanning the full `DOCS` array with their own `d=>d.date===k` / `d=>d.category===c` predicate — same grouping recomputed over and over across the file. Added two lookups built once (`docsByDate`, `docsByCategory`, both `DOCS.reduce(...)` grouping by key) right next to where `dateKeys`/`catKeys` were already computed, and pointed every call site at them instead.

**Bug caught mid-refactor:** `docsByDate[k]`/`docsByCategory[k]` are *shared* array references (unlike the old `DOCS.filter(...)` which returned a fresh array every call). Several call sites chained `.sort()` directly onto the filter result (`firstDoc`, `docsOfDay` in the changelog, `docsToday` in the standup export, and the category/date detail-page docs lists) — `.sort()` mutates in place, so sorting a shared reference would have silently reordered it for every other consumer reading that same date/category later. Fixed by spreading into a fresh array first (`[...docsByDate[k]].sort(...)`) at every site that sorts; left the read-only sites (`.reduce`/`.length`/`.filter`, which don't mutate) reading the shared array directly.

**Verification:** `node --check` clean. Independently recomputed every touched value from the live `DOCS` array in Node (old inline-filter logic vs. new lookup-based logic) rather than trusting the browser preview alone, since the preview's `file://` "static snapshot" mode doesn't tick `requestAnimationFrame` (so `animateCount`-driven KPIs like Avg Tests/Session, Completion Rate, and Files Created render "—" there even though the computation itself is correct — confirmed both display as `66` and `91%` and `539`, matching the pre-refactor numbers exactly, when computed directly). Also diffed the four sparkline data arrays (`sparkAvg`, `sparkCreated`, `sparkComp`, `cumData`) old-logic vs. new-logic — all four exact matches. Browser-rendered sections unaffected by the rAF quirk (insights, achievements, changelog breakdown, heat-strip, category leaderboard) were re-checked live and still matched.
