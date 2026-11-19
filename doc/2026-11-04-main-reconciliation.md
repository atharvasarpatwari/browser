# Reconciling the Two Diverged `main` Histories

**Date:** 2026-11-04
**Session:** Close sections 1 and 2 of the 2026-11-04 project gap audit
**Status:** Completed (not pushed)

---

## Summary

Local `main` and `origin/main` had diverged both ways since mid-October — 38 commits
here that were never pushed, 12 there that were never pulled — so no CI run had ever
seen the code that actually exists. This session committed the outstanding local work,
merged the two histories, resolved the fallout from origin's dead-code purge, and fixed
the one genuine clean-clone build break.

`main` is now **0 behind / 50 ahead** of `origin/main`, a clean fast-forward, with the
full suite green: **261 files, 10,255 tests, 0 failures**. Nothing has been pushed.

## Root Causes

### 1. A dead-code purge made on a branch that never saw the local work

**Commits:** `9f965ba`, `ac6c172` (on `origin/main`)
**Problem:** Those commits deleted 63 files that were genuinely dead *on that branch*.
That branch did not contain local `main`'s search subsystem, page scroll/selection, or
Nova Android v1.2–v1.9. On this tree 22 of the deleted files were still imported —
`src/app/main.ts` among the importers — so merging the purge as-is would have broken the
build outright. Git only flags the files both sides touched; the rest delete silently.

**Fix:** Resolved per file rather than per side:

- 13 modify/delete conflicts kept — the whole `omnibox/` and `navigation-controls/`
  subsystems, which local `main` actively modifies
- 35 silently-deleted files restored, by grepping surviving code for imports of each
  deleted module and iterating to a fixed point (29 on the first pass, 6 on the second,
  0 on the third)
- 3 test files restored whose modules survive (`credentials`, `devtools-panels`,
  `screen-reader`); 11 dropped along with the modules they covered
- 28 genuinely orphaned source files left deleted — that part of the purge was correct

### 2. `privacy-gate.ts` was never committed, and `main.ts` imports it

**File:** `src/browser/security/privacy-gate.ts`
**Problem:** `src/app/main.ts:101` has `import { PrivacyGate } from '../browser/security/privacy-gate';`
in committed code, but the module itself was untracked. A clean clone of `main` could not
typecheck, build or package. Local work never noticed because the file is present on disk.
**Fix:** Tracked the file (`40f3799`). It typechecks clean on its own.

### 3. An uncommitted local edit had swapped in a broken SHA-256

**File:** `src/browser/networking/tls-handler.ts` (working tree only, never committed)
**Problem:** An uncommitted edit changed the TLS certificate fingerprint helper from the
tracked `../security/crypto-utils` (`hashSync`) to an untracked
`./crypto-utils` (`sha256Hex`). That untracked module is not a working SHA-256: it never
pads the message, reads words little-endian, computes `maj` and never uses it, has a
corrupted round-constant table, and handles only a single 64-byte block. Measured against
`node:crypto`:

```
input: "abc"
  node:crypto             ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad
  networking/crypto-utils THREW: Offset is outside the bounds of the DataView  <-- WRONG
  security/crypto-utils   ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad  MATCH
input: "aaaaaaaaaaaa..." (100 bytes)
  node:crypto             2816597888e4a0d3a36b82b83316ab32680eb8f00f8cd3b904d681246d285a0e
  networking/crypto-utils 36c923a4fe74c84d955fb79f0871d81a790856700b973942e10708113fde967f  <-- WRONG
  security/crypto-utils   2816597888e4a0d3a36b82b83316ab32680eb8f00f8cd3b904d681246d285a0e  MATCH
```

Worse, `TlsHandler.sha256Hex` wraps the call in a bare `catch` that falls back to a
trivial 32-bit string hash — so for any input under 64 bytes the throw was swallowed and
certificate fingerprints were computed with a toy hash, silently.

**Fix:** Restored the tracked import. `tls-handler.ts` now matches `HEAD` exactly. The
broken module remains untracked on disk and is backed up outside the repo; nothing tracked
imports it.

### 4. Origin's keyboard-nav wiring met a mock that predates it

**File:** `tests/search-integration.test.ts`
**Problem:** The merge brought in `BrowserWindowPage.setSettingsService` calling
`service.onChange(...)` (browser-window.ts:1823). `onChange` is part of `ISettingsService`
(`settings-service.ts:25`), but this file's hand-built mock omitted it, so all 135 tests in
the file threw `TypeError: service.onChange is not a function`.
**Fix:** Added `onChange: () => undefined` to the mock factory. 135/135 pass.

## Three mistakes made and corrected in this session

Recorded because each one would have shipped quietly:

1. **The gap audit named the wrong file.** It claimed `crypto-utils` broke the clean
   clone. Both `main` and `origin/main` already imported the tracked module; the real
   break was `privacy-gate.ts`. The audit has not been amended — read §2.1 there with
   this correction.
2. **The restore pass matched by basename.** It resurrected
   `rendering/pipeline/rasterizer.ts` and `render-tree.ts` on the strength of imports
   that actually resolve to `rendering/rasterizer.ts` and `rendering/render-tree.ts`.
   `tsc` caught it — `pipeline/rasterizer.ts` imports three modules the purge removed.
   Removed in `1c63440`.
3. **Resolving `analytics.html` as a union corrupted it.** Concatenating both sides
   duplicated the `2026-10-10-url-parsing` entry and left two entries without trailing
   commas where the blocks joined, so the `DOCS` array stopped parsing and the dashboard
   would not have rendered. Repaired in `ec90a8a`; same 379 unique entries, verified
   parsing. `doc/README.md` had the same duplication, fixed in `d3d0033`.

## Files Modified

| File | Change |
|------|--------|
| `.gitignore` | Ignore root `/target/` (297 MB of cargo output) and the debug dumps |
| `src/browser/omnibox/index.ts` | Committed alongside the two modules it re-exports |
| `src/ui/components/toolbar/toolbar.view.ts` | Legacy `.address-bar` class restored beside `.nova-addressbar` |
| `src/ui/layout/desktop-layout.ts` | Legacy `.tab-strip` / `.toolbar` classes restored |
| `src/browser/security/permission-manager.ts` | `checkSecureContext()` gates powerful permissions |
| `package.json` | Union: `benchmark:search` plus origin's `--features dns,tls,http` |
| `src/browser/navigation/router.ts` | Union: both `nova://dashboard` and `nova://privacy` |
| `src/ui/pages/browser-window.ts` | Union: search-engine wiring plus extensions/privacy/keyboard-nav |
| `src/ui/pages/settings-page.ts` | Union: privacy settings plus privacy actions, menu section kept |
| `tests/search-integration.test.ts` | `onChange` added to the settings-service mock |
| `tests/android-native-bridge.test.ts` | Union of both mock shapes |
| `.claude/launch.json` | Kept the `nova-dev` configuration name |
| `doc/analytics.html`, `doc/README.md` | 47 new entries; union damage repaired |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/security/privacy-gate.ts` | Was untracked while `main.ts` imported it |
| `src/browser/omnibox/opensearch-parser.ts` | Was untracked while `omnibox/index.ts` re-exported it |
| `src/browser/search/inverted-index.ts` | Same |
| `doc/2026-11-04-project-gap-audit.md` | The audit this session acts on |
| `doc/2026-11-04-main-reconciliation.md` | This document |
| 46 change logs under `doc/` | Android 1.26–1.76 and the JS plans, written but never committed |

## Files Removed

91 files, all from origin's purge, kept only where nothing references them: the
`rendering/pipeline/` directory, `pdf-viewer/pdf-renderer.ts`, `html5/dom-token-list.ts`,
`process/renderer-entry-sandboxed.ts`, `common/ipc/child-entry.ts`,
`platform/shared/platform-events.ts`, 11 test files whose modules went with them, and the
stale `dashboard/`, `analysis-report/` and `_kt_stage/` leftovers. `logcat.txt` (1.7 MB)
and `inst_user_settings.tmp` were untracked but left on disk.

## Test Results

```
$ npx tsc --noEmit
(no errors from tracked files; the only output is 22 errors inside the untracked
 src/browser/service-worker/ files, which do not typecheck and are not committed)

$ npx vitest run
 Test Files  261 passed (261)
      Tests  10255 passed (10255)
   Duration  257.99s
```

261 is the exact number of tracked `tests/**/*.test.ts` files excluding `tests/e2e/`, so
collection was complete. An earlier run that reported 206 files was measured against a
different branch after the checkout was switched mid-run, and a run reporting 39 failed
files was degraded by concurrent git activity; neither reflects this tree.

## Verification

```bash
cd /e/nova_1
git rev-list --left-right --count origin/main...main    # 0  50
git merge-base --is-ancestor origin/main main           # clean fast-forward
git status --porcelain | grep -vc '^??'                 # 0
node -e "...parse the DOCS array..."                    # 379 entries, 0 duplicates
```

Import integrity was checked directly rather than by cloning: every relative import in
every tracked `.ts`/`.cjs` file was resolved against the tracked file list — **1807
imports, 0 unresolved**. The two flagged were false positives (a `.js` specifier that
resolves to `math-functions.ts`, and a line inside a comment).

All 38 previously-unpushed commits are reachable from `main`, including the 8 that existed
on no remote at all (`1aeab83`, `f520b05`, `01c0861`, `3b95673`, `dfa3334`, `0bc3a4c`,
`ec16dd3`, `6927ffb`).

Safety tags, removable once this is pushed and settled:

- `backup/pre-reconcile-2026-11-04` → `6927ffb` (local `main` before any of this)
- `backup/pre-merge-2026-11-04` → `40f3799` (after the local commits, before the merge)

## Not done

- **Nothing is pushed.** `main` is 50 commits ahead of `origin/main`; the push is a
  fast-forward, not a force, but it lands 91 file removals on the shared branch.
- The 6 open PRs are untouched. Several (#4 search subsystem, #5 `.nova-*` classes) overlap
  work now on `main` and will need rebasing or closing.
- The untracked leftovers under `src/` remain on disk: `service-worker/` (does not
  typecheck), `webrtc/`, `extensions/`, `dashboard/`, `find/`, `webgpu-context.ts`,
  `networking/crypto-utils.ts` (the broken SHA-256). Nothing tracked imports any of them;
  each needs a commit-or-delete decision.
- `doc/2026-11-04-project-gap-audit.md` §2.1 still names the wrong file, as noted above.
