# Roadmap Groundwork — Staging Placement & Release CI Matrix

**Date:** 2026-08-27
**Session:** Placement of `nova-roadmap-groundwork/` staging folder + closing the missing multi-OS release workflow
**Status:** Completed

---

## Summary

The `nova-roadmap-groundwork/` folder was a record/mirror copy of the 2026-08-27 "Roadmap Groundwork" session's changes (`doc/2026-08-27-roadmap-groundwork.md`). This session audited every file in it against its real destination, confirmed all 13 were already byte-identical, wrote the one piece that was missing from the repo (the 3-OS release CI matrix the groundwork doc described but never applied), verified the groundwork changes, and deleted the now-redundant folder.

## Findings

### 1. All 13 mirrored files already applied
Every file in `nova-roadmap-groundwork/` matched its destination byte-for-byte:

| Destination | Status |
|-------------|--------|
| `electron/main.cjs` | identical |
| `package.json` | identical |
| `electron-builder.yml` | identical |
| `android/app/build.gradle` | identical |
| `android/.gitignore` | identical |
| `android/keystore.properties.example` | identical |
| `TODO.md` | identical |
| `INSTALL.md` | identical |
| `doc/README.md` | identical |
| `doc/crash-isolation-scoping.md` | identical |
| `doc/android-release-signing.md` | identical |
| `doc/known-test-failures.md` | identical |
| `doc/2026-08-27-roadmap-groundwork.md` | identical |

### 2. Missing piece — the multi-OS release workflow

`WHERE-THESE-GO.txt` and `doc/2026-08-27-roadmap-groundwork.md` both stated the release pipeline was extended from Windows-only to a Windows/macOS/Linux matrix. But:

- `nova-roadmap-groundwork/` never contained `.github/workflows/release.yml` (the session that produced it couldn't write workflow files — GitHub blocks automated writes there)
- The live `.github/workflows/release.yml` was still Windows-only (`runs-on: windows-latest`, only `npm run build:win`)
- `package.json` already had the `build:mac` / `build:linux` scripts, but nothing invoked them

**Fix:** rewrote `release.yml` as a 3-OS strategy matrix:

```yaml
strategy:
  fail-fast: false
  matrix:
    include:
      - os: windows-latest
        script: build:win
      - os: macos-latest
        script: build:mac
      - os: ubuntu-latest
        script: build:linux
      # ...
      CSC_IDENTITY_AUTO_DISCOVERY: "false"   # unsigned mac build must not fail
```

Each leg runs `npm ci` + its platform build script, verifies `release/` output, and publishes to the same GitHub Release via `softprops/action-gh-release` (globs cover `.exe`/`.blockmap`/`.dmg`/`.AppImage`/`.deb`/`.rpm`/`*.yml` — unmatched globs are ignored per platform). `fail-fast: false` keeps one platform failure from cancelling the others.

## Files Modified

| File | Change |
|------|--------|
| `.github/workflows/release.yml` | Rewrote Windows-only workflow → 3-OS strategy matrix (win/mac/linux builds + single release publish, `CSC_IDENTITY_AUTO_DISCOVERY: false`) |

## Files Deleted

| File | Reason |
|------|--------|
| `nova-roadmap-groundwork/` (13 mirrored files + `WHERE-THESE-GO.txt`) | Redundant record copy — all contents confirmed identical + workflow now closed the gap |

## Test Results

```
npx tsc --noEmit        → 0 errors
npx vitest run          → 205 files / 9082 tests passed (0 failures)
release.yml read-back   → 3-OS matrix confirmed present
```

## Verification Steps

- `npm run build:win` — still works (unchanged Windows leg of the matrix)
- The macOS/Linux legs only prove out on a real tag push — `git tag v0.0.0-test && git push --tags` against a throwaway tag is the safe check (matching the groundwork doc's own recommendation)
- Not run this session: `npm run build:mac` / `npm run build:linux` (require macOS/Linux hosts; see note above and installers remain unsigned — see `INSTALL.md`)