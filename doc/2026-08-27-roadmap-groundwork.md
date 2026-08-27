# Roadmap Groundwork — CI Fixes, Auto-Update, Android Signing, Crash-Isolation Scoping

**Date:** 2026-08-27
**Session:** Implementing the first slice of the "ready for use" implementation roadmap (P0/P1/P2 items that are pure config/doc work, not requiring a build or test run)
**Status:** Completed (source/config changes) — **none of this was built, run, or tested this session, see Test Results**

---

## Summary

Followed up the implementation roadmap (published as an Artifact the same day) by making the
concrete, file-level changes that don't require running a build to write correctly: corrected
two stale claims in `TODO.md` (CI gating was already done; the fidelity audit was already
fixed — both contradicted the file's own "Done" section), extended the release pipeline from
Windows-only to a Windows/macOS/Linux matrix, added guarded auto-update and main-process crash
logging to the Electron app, scaffolded optional Android release signing, and wrote three new
docs: a crash-isolation scoping pass, an Android signing guide, and an end-user install guide
(the existing `doc/` is a 200+ session engineering log — genuinely useful, but not something to
point someone at just to install the app).

This session had file-bridge read/write access to the repo but no shell access to the connected
machine — every change below is written correctly per the existing conventions in each file, but
**none of it has been run**. Explicitly out of scope this session: the actual Modern Web
Platform items (Service Workers, WebRTC, WASM, CSS containment) — those need real engineering
work grounded in the existing rendering/engine source, not blind changes without test execution.

## Files Modified

| File | Change |
|------|--------|
| `TODO.md` | Corrected two stale "still open" claims (CI gating, fidelity audit — both were already done, contradicting the file's own "Done" list); refreshed date; added tracking entries for everything below |
| `.github/workflows/release.yml` | Was Windows-only; extended to a Windows/macOS/Linux build matrix, each platform uploading its own installer types to the same GitHub Release; added `CSC_IDENTITY_AUTO_DISCOVERY: false` so the unsigned mac build doesn't fail looking for a local signing identity |
| `electron-builder.yml` | Added a `publish` block (`provider: github`, `owner: atharvasarpatwari`, `repo: browser`) so `electron-updater` on the client side knows where to check for releases |
| `package.json` | Added `build:mac` / `build:linux` scripts (mirroring the existing `build:win`); added `electron-updater` to dependencies |
| `electron/main.cjs` | Added `process.on('uncaughtException'/'unhandledRejection')` handlers (main-process crashes were previously uncaught — only renderer crashes were handled); added a guarded `setupAutoUpdater()` (skips cleanly when unpackaged/dev, never blocks startup, logs every step through the existing `writeHealthLog`) called from `app.whenReady()` |
| `android/app/build.gradle` | Added an optional `signingConfigs.release` block that reads from a gitignored `android/keystore.properties` when present; release builds stay unsigned exactly as before when it's absent |
| `android/.gitignore` | Uncommented the (previously disabled) `*.jks`/`*.keystore` ignore rules; added `keystore.properties` |
| `doc/README.md` | Indexed the new files below |

## Files Created

| File | Purpose |
|------|---------|
| `doc/crash-isolation-scoping.md` | Scopes a minimal-first step for TODO.md's parked "Multi-Process" item, grounded in how the Electron/Android shells actually run tabs today (one renderer/WebView, not one per tab) — proposes writing a regression test before committing to a bigger design |
| `doc/android-release-signing.md` | How to generate a release keystore and wire it into the new `build.gradle` signing config; notes what's still needed beyond this repo for Play Store distribution |
| `doc/known-test-failures.md` | Tracking template for the "pre-existing failures" repeatedly referenced across session logs without ever being named specifically — needs a real `npm test` run to populate, which this session couldn't do |
| `android/keystore.properties.example` | Template for the gitignored `android/keystore.properties` |
| `INSTALL.md` | End-user install guide (Windows/macOS/Linux/Android), including an honest note that builds are unsigned today and what OS warnings to expect |
| `doc/2026-08-27-roadmap-groundwork.md` | This document |

## Test Results

**Not run this session.** File-bridge access only (list/read/write), no shell/npm/Gradle/git
access to the connected machine. Every change was written to match the existing file's own
conventions exactly (verified by reading each file in full before editing), but none of the
following has been confirmed:

- `npm run typecheck` / `npm test` still pass after the `package.json` and `main.cjs` changes
- `npm run build:mac` / `npm run build:linux` actually succeed (new scripts, never run)
- The `release.yml` matrix actually completes on all three OS runners
- `android/app/build.gradle` still parses/builds correctly with the added `signingConfigs` block
  (Groovy syntax was written carefully, but Gradle itself hasn't evaluated it)
- The auto-update check in `main.cjs` actually finds/offers an update against a real tagged
  release (there isn't one yet with this publish config)

**Verification steps for whoever picks this up:**
```bash
npm ci
npx tsc --noEmit
npm test
npm run build:win   # or build:mac / build:linux on the matching OS
cd android && gradlew.bat assembleDebug && gradlew.bat assembleRelease
```
The release-signing and matrix-CI changes specifically only prove out on a real tag push —
`git tag v0.0.0-test && git push --tags` against a throwaway tag is a safe way to confirm the
three-OS release build actually works before it matters.
