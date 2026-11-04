# Dead Code Audit and Cleanup

**Date:** 2026-10-14
**Session:** Re-audited the repo for dead/orphaned code (the prior audit was 2026-10-11/12, before several branches merged in since), then deleted everything confirmed dead after user approval.
**Status:** Completed

---

## Summary

Two parallel Explore passes covered the repo (`src/` TypeScript tree separately from everything else — `tests/`, `electron/`, `native/` Rust, `android/`, root-level files, `scripts/`, `analysis-report/`). Every candidate was grep-verified repo-wide before being called dead, learning from the 2026-10-12 audit's documented false-negative trap (relative/aliased/`.cts`/`.js`-suffixed imports defeat naive grep). One candidate the audit called "dead weight" (`src/browser/media/index.ts`) was caught and excluded during the deletion pass itself — it's actually the live import path for `tests/runtime.test.ts`, `tests/js-language.test.ts`, and `tests/js-engine.test.ts`, which pull core JS-engine services (`BytecodeService`, `VariableService`, etc.) through that barrel. Deleting it would have broken three real test files; left in place.

52 files deleted total. `npx tsc --noEmit` clean (0 errors); full suite 206/206 files, 8660/8660 tests (down from 8667 — the expected 7-test drop from removing the `NovaDnsResolver` describe block, see below).

## Root Causes (problem → fix)

### 1. Seven genuinely-orphaned `src/` modules
**Files:** `src/platform/shared/platform-events.ts`, `src/browser/rendering/html5/dom-token-list.ts`, `src/native/dns-resolver.ts`, `src/browser/extensions/index.ts`, `src/process/renderer-entry-sandboxed.ts`, `src/common/ipc/child-entry.ts`
**Problem:** Each had zero importers anywhere in `src/` or `tests/` (confirmed by grep, not just the agent's first pass).
**Fix:** Deleted. `src/native/dns-resolver.ts`'s `NovaDnsResolver` class was exercised only by its own test block (`describe('NovaDnsResolver', ...)`, 7 tests) inside `tests/native/native-bindings.test.ts` — trimmed that block and its now-unused `NovaDnsResolver`/`DnsResult` imports out of the test file (same pattern as the 2026-10-12 cleanup's `NovaHttpClient` trim). Note: `src/process/renderer-entry-sandboxed.ts` and `src/common/ipc/child-entry.ts` belong to the parked Phase-2 multi-process feature (`TODO.md` §6) — a separate, already-known latent bug was surfaced while verifying this: `src/app/config/process-model.ts`'s three presets hardcode `rendererEntryPath: 'src/process/renderer-entry.ts'`, a file that no longer exists (superseded by the now-also-deleted `renderer-entry-sandboxed.ts`). Not fixed here — only relevant if that parked feature gets picked back up — but left noted in case someone activates `NOVA_PROCESS_ISOLATION` later and the fork silently points at nothing.

### 2. `src/browser/media/index.ts` was misdiagnosed as dead — caught before deletion
**File:** `src/browser/media/index.ts`
**Problem:** The audit pass noted this barrel has zero importers *within `src/`* and called it "dead weight," since everything it re-exports is also reachable via direct relative imports elsewhere. That framing undersold a real dependency: `tests/runtime.test.ts`, `tests/js-language.test.ts`, and `tests/js-engine.test.ts` import `CallStackService`, `VariableService`, `BytecodeService`, and 15 other core JS-engine/runtime services **through this exact barrel**, not via direct paths.
**Fix:** Verified with a direct grep across `tests/` before deleting anything (not just `src/`), found the three live importers, and excluded this file from the cleanup. Flagging as a process note: the original audit's "zero importers in src/" framing is technically true but incomplete — always check `tests/` too before calling a barrel dead, since test-only imports are still load-bearing.

### 3. Leftover Capacitor/Cordova-era Android artifacts (two files the 2026-08-28 cleanup missed)
**Files:** `android/app/capacitor.build.gradle`, `android/app/src/main/res/xml/config.xml`, `capacitor.config.ts` (repo root)
**Problem:** The real app is a Kotlin/Compose native app; Capacitor was an earlier, abandoned approach. TODO.md's 2026-08-28 cleanup removed `capacitor.settings.gradle`, `capacitor-cordova-android-plugins/`, and `assets/public/`, but these three differently-named leftovers survived that pass — none referenced in any Gradle file, manifest, or Kotlin source.
**Fix:** Deleted all three, plus the `@capacitor/android`, `@capacitor/cli`, `@capacitor/core` entries from `package.json`'s `dependencies` (confirmed unreferenced by any npm script, and not even present in `node_modules` already — stale lockfile entries only). Ran `npm install` afterward to sync `package-lock.json` (641 lines removed, mostly the capacitor dependency subtree).

### 4. Stale pre-refactor Kotlin snapshot and an abandoned standalone dashboard prototype
**Paths:** `_kt_stage/` (18 `.kt` files), `dashboard/` (20 files, a separate React/Vite app)
**Problem:** `_kt_stage/` mirrors `android/app/src/main/java/com/nova/browser/**` by filename but holds pre-refactor logic (diffed `BrowserViewModel.kt`: old inline `resolveInput()` vs. the real file's `UrlInputResolver` delegation) — not read by any build. `dashboard/` is a fully independent React/Vite new-tab prototype with its own `package.json`/deps, not referenced from root `package.json`, not imported from `src/`, and `git log -- dashboard/` shows only 3 early generic commits with nothing since. (`DEVELOPMENT-PROCESS.md` mentions `dashboard/` as if live, but that doc's own stated codebase size — "~87 files, ~37 TypeScript source files, 470 passing tests" — is itself a stale early-era snapshot wildly inconsistent with the current ~400+ file, 8000+ test repo, so it isn't evidence of current wiring.)
**Fix:** Deleted both directories after explicit user confirmation on `dashboard/` specifically (it's a non-trivial amount of standalone work, flagged for a sign-off rather than auto-deleted). `DEVELOPMENT-PROCESS.md` and `docs/DEVELOPMENT-PROCESS.md` still mention the now-deleted `dashboard/` — left as-is (stale-doc cleanup is a separate task, not silently rewritten here).

### 5. Stray local/debug artifacts at repo root
**Files:** `logcat.txt` (1.75 MB raw adb capture), `inst_user_settings.tmp` (local Android SDK path dump), `nova-analytics-backup.json` (one-off 2026-07-26 TODO export), `release-n5/win-unpacked.tmp/` (doesn't match `electron-builder.yml`'s configured `release` output dir)
**Problem:** None referenced by any script, doc, or config — plain leftover artifacts from local runs.
**Fix:** Deleted.

## Files Deleted (52 total)
| Category | Count | Paths |
|------|------|--------|
| `src/` orphaned modules | 6 | `platform-events.ts`, `dom-token-list.ts`, `dns-resolver.ts`, `extensions/index.ts`, `renderer-entry-sandboxed.ts`, `child-entry.ts` |
| Android Capacitor/Cordova leftovers | 2 | `android/app/capacitor.build.gradle`, `android/app/src/main/res/xml/config.xml` |
| Root config | 1 | `capacitor.config.ts` |
| `_kt_stage/` | 18 | stale pre-refactor Kotlin snapshot |
| `dashboard/` | 20 | abandoned standalone React/Vite prototype |
| Stray root artifacts | 4 | `logcat.txt`, `inst_user_settings.tmp`, `nova-analytics-backup.json`, `release-n5/win-unpacked.tmp/resources/default_app.asar` |

## Files Modified
| File | Change |
|------|--------|
| `tests/native/native-bindings.test.ts` | Removed the `NovaDnsResolver` describe block (7 tests) and its now-unused `NovaDnsResolver`/`DnsResult` imports |
| `package.json` | Removed `@capacitor/android`, `@capacitor/cli`, `@capacitor/core` from `dependencies` |
| `package-lock.json` | Regenerated via `npm install` to drop the now-unreferenced capacitor dependency subtree |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-10-14-dead-code-audit-and-cleanup.md` | This change log |

## Test Results
```
npx tsc --noEmit
  0 errors

npx vitest run
  Test Files  206 passed (206)
  Tests       8660 passed (8660)
  Duration    174.48s
  (was 8667 before this session's deletions — the expected -7 from
  removing the NovaDnsResolver test block)
```

## Verification Steps
1. Two parallel Explore agents audited `src/` and everything else, each grep-verifying candidates repo-wide before calling them dead.
2. Presented the full findings to the user (confirmed-dead / lower-confidence / ruled-out-false-positive, in three tiers) before touching anything.
3. User approved deletion of the confirmed-dead list, with one explicit follow-up confirmation on `dashboard/` specifically (flagged as worth a sign-off given its size).
4. Before deleting, re-verified every `src/` candidate once more against `tests/` (not just `src/`) — caught `src/browser/media/index.ts` as a false positive this way (see Root Cause 2) and excluded it.
5. Deleted all 52 confirmed files/directories, trimmed the one dependent test block, removed the matching `package.json` deps, ran `npm install` to sync the lockfile.
6. `npx tsc --noEmit` — 0 errors. `npx vitest run` — full suite green, test-count delta matches exactly what was intentionally removed.
