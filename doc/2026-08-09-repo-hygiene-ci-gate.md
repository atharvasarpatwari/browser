# Repo Hygiene + CI Gate

**Date:** 2026-08-09
**Session:** Housekeeping — untrack Rust build artifacts, drop debug leftovers, refresh stale TODO, add CI gate workflow, commit 3 pending sessions
**Status:** Completed

---

## Summary

Cleaned the repository (untracked 2,139 `native/target/` build-artifact files, removed debug leftovers, refreshed the stale `TODO.md`), added a GitHub Actions CI gate (typecheck + full vitest + Electron e2e on push/PR), and committed the pending 08-08 sessions (web-storage disk persistence, Phase-1 plugins, CSS recreation, fidelity audit) as 4 logical commits. Full suite verified green: 8693/8693 vitest, tsc clean, 3/3 Electron e2e.

## Changes

### 1. Untrack Rust build artifacts
**Problem:** `native/target/` (2,139 files: `.fingerprint/*`, `.d/*`, `.rlib`, `.exe`, lock files) was committed to git — every `cargo build` dirtied the tree with hundreds of binary/dependency files.
**Fix:** `git rm -r --cached native/target` (keeps files on disk) and added to `.gitignore`:
```
native/target/
native/dist/
fidelity-report/
electron-err.tmp.txt
electron-out.tmp.txt
```

### 2. Remove debug leftovers
Deleted `_diag.mjs` (08-07 diagnostic script), `layout-test-error.txt` / `layout-test-output.txt` (07-31 test dumps), `electron-err.tmp.txt` / `electron-out.tmp.txt` (08-08/09 debug redirects). The tmp files were locked by a still-running Nova Electron instance (PID 16620 + 3 stale instances from 08-08) — stopped them first, then removed the files.

### 3. Refresh stale TODO.md
All 5 open TODO items (PageLoader wiring, IPC direction, image decoding, microtasks, Electron window) were already implemented per 08-08 docs. Moved them to **Done** and replaced the High/Medium/Low sections with forward-looking roadmap items (CI gate, fidelity audit drive, native Rust wiring, multi-process, shipping, web platform).

### 4. CI gate (Phase 0)
New `.github/workflows/ci.yml`:
- **Triggers:** push to `main`, PR to `main`
- **Job `check`:** `npm ci` → `npm run typecheck` → `npm test` (full vitest)
- **Job `e2e`:** `npm ci` → `npm run build:web` → `npx playwright test --config=playwright-electron.config.cjs`
- Both on **windows-latest** to mirror the locally-verified environment (the suite is only guaranteed green on Windows; Linux parity is a future task). `execArgv: --max-old-space-size=6144` already in `vitest.config.ts` prevents the 6GB-worker OOM in CI.

## Fidelity Finding (actionable follow-up)

Running the full e2e suite surfaced a real rendering problem that the audit's weak assertions mask:
- **Every** one of the 12 fixtures produced an **identical** canvas: `nonWhite=0.0008 clusters=2 top=#383838x294582 #000000x1647` — i.e. the page canvas only ever shows the dark browser-chrome background; **no fixture content renders** in the Electron host (even the white-background `blank` fixture).
- `basic` still passes its assertion (`colorClusters > 1`) because 2 clusters > 1 — the assertion is too weak to detect a blank page.
- Suggested next step: debug why the engine canvas never paints page content in the packaged Electron build (compare against the dev-server run where example.com/mail.com rendered on device), then strengthen audit assertions (e.g. nonWhiteRatio thresholds) and re-run.

## Files Modified

| File | Change |
|------|--------|
| `.gitignore` | Added `native/target/`, `native/dist/`, `fidelity-report/`, `electron-err.tmp.txt`, `electron-out.tmp.txt` |
| `TODO.md` | Stale items → Done; new roadmap High/Medium/Low sections |
| `doc/analytics.html` | Trailing-newline fix (part of hygiene commit) |
| `doc/README.md` | Indexed this change log |
| `doc/2026-08-08-css-recreation.md`, `doc/2026-08-08-future-scope-plan.md`, `doc/2026-08-08-phase1-persistence-plugins-deferred.md`, `doc/2026-08-08-web-storage-disk-persistence.md` | Committed (new, from prior sessions) |

## Files Created

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | CI gate: typecheck + vitest + Electron e2e on push/PR |
| `doc/2026-08-09-repo-hygiene-ci-gate.md` | This change log |

## Commits

| Commit | Summary |
|--------|---------|
| `1631cce` | chore(housekeeping): untrack native build artifacts, drop debug leftovers, refresh TODO |
| `38296dd` | feat(phase1): web-storage disk persistence, persistent passwords, deferred navigation, pluggable font metrics |
| `032ecef` | feat(ui): recreate styles.css design system; add fidelity audit e2e |
| `9252d19` | ci: add typecheck + vitest + electron e2e gate on push/PR |

## Test Results

```
$ npm run typecheck
(no output — clean)

$ npm test
Test Files  190 passed (190)
     Tests  8693 passed (8693)
Duration   143.16s

$ npx playwright test --config=playwright-electron.config.cjs
✓ tests\e2e\electron-smoke.spec.ts › Nova Browser launches in Electron and renders content (3.2s)
✓ tests\e2e\fidelity-audit.spec.ts › Nova fidelity audit over crafted fixtures (45.4s)
✓ tests\e2e\keep-alive.spec.ts › Nova Browser stays open and responsive via the health probe (9.7s)
3 passed (1.0m)
```

**Verification steps:** typecheck → full vitest suite → `npm run build:web` → full Electron e2e (3 specs incl. fidelity audit). All green. Git status clean after commits (branch 4 commits ahead of origin, **not pushed** — push is left to the user).
