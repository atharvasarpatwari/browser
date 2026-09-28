# The Release Pipeline Had Never Actually Run — A Throwaway Tag Found Three Real Bugs, Including One I Introduced Fixing the First

**Date:** 2026-09-25
**Session:** Asked to plan the next deployment; chose "test-tag pipeline verification" over cutting a real v1.0.0. Pushed a disposable `v0.0.0-test` tag to prove `.github/workflows/release.yml` mechanically works end-to-end for the first time ever.
**Status:** Completed (4 root causes fixed)

---

## Summary

`release.yml` (builds installers on windows/macos/ubuntu on any `v*` tag push, publishes to GitHub Releases) had never run — `git tag -l` and `gh release list` were both empty. The first real run failed on all three platforms, each for a different reason. Fixing the most obvious one (Windows) with a blunt `publish: null` created a second, subtler bug of its own — one that would have silently broken `electron-updater` again, the exact thing the previous session's fix had just gotten working. A second real tag push, after both fixes, produced a fully green run with the correct assets on all three platforms.

## Root Causes

1. **`electron-builder.yml` had its own `publish:` (GitHub) block, so a tag push made electron-builder try to publish itself with no `GH_TOKEN`.** `release.yml`'s actual publish step is a separate `softprops/action-gh-release@v2` action later in the workflow — electron-builder was never supposed to upload anything itself. Since a tag push satisfies electron-builder's "implicit publish" auto-detection, and the workflow's build step sets no `GH_TOKEN`, `electron-builder --win` failed outright with `GitHub Personal Access Token is not set`. First fix: `publish: null`, on the theory that this only needed to stop the accidental upload.
2. **That first fix was wrong: it also silently stopped `latest.yml`/`latest-mac.yml`/`latest-linux.yml` from being generated at all.** electron-builder only writes those update-manifest files — the ones `electron-updater` actually reads — when it has a publish target configured; `publish: null` gives it none. The retried run went fully green with `publish: null` in place, which would have looked like total success, but the resulting release had no `.yml` assets — the same silent `electron-updater` breakage the *previous* session's `node_modules`-exclusion fix had just resolved, reintroduced by this session's own first attempt at a different fix. Caught by explicitly checking the asset list rather than trusting "the run went green" (the exact risk the approved plan had called out in advance). Real fix: restore the `publish:` provider block (needed for the manifests' repo metadata) and instead pass `--publish=never` on each build script's CLI — the standard electron-builder pattern that generates the manifests locally without electron-builder uploading them itself.
3. **macOS build failed: `build/icon.png` was 256×256, below the 512×512 minimum for `.icns` generation.** No higher-resolution source existed anywhere in the repo. Upscaled to 1024×1024 via bilinear interpolation using the already-installed `pngjs` dependency (no new dependency added) — a stopgap to unblock the pipeline test, not a substitute for real redesigned artwork.
4. **Linux `.deb` build failed: `package.json` had no `author` field at all**, required for the package's maintainer metadata. Added one — used a GitHub no-reply email (`atharvasarpatwari@users.noreply.github.com`) rather than a personal address, since this repo is public and a permanent public commit isn't the place to default to putting someone's real email without asking first.

## Notes

- Confirmed the release created zero partial state before cleanup: since the "Publish GitHub Release" step never ran on any platform in the first (all-failed) run, there was no dangling release object to clean up before the second attempt — just delete-and-repush the tag.
- Deliberately did not touch `socket-owner.ts`'s TLS behavior or anything unrelated while fixing this — kept the diff to exactly the three packaging-config issues the real run surfaced.
- The corrected run's asset list was checked explicitly (`gh release view --json assets`), not just the run's pass/fail summary — `fail-fast: false` plus three independent `action-gh-release` calls against the same tag means one platform's job could fail *after* its own publish step while the run still reads as an overall success.
- Cleanup order matters and was followed: release deleted before the remote tag, before the local tag, to avoid a dangling half-deleted state.

## Files Modified

| File | Change |
|------|--------|
| `electron-builder.yml` | Restored the `publish: {provider: github, owner, repo}` block (after a same-session detour through `publish: null`, which broke update-manifest generation) |
| `package.json` | Added `author` (name + GitHub no-reply email); appended `--publish=never` to `build:win`/`build:mac`/`build:linux` |
| `build/icon.png` | Upscaled 256×256 → 1024×1024 (bilinear, via `pngjs`) to clear macOS's 512×512 `.icns` minimum |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-09-25-release-pipeline-first-real-run-found-three-bugs.md` | This change log |

## Test Results

```
First v0.0.0-test run   → all 3 platforms FAILED at the build step (GH_TOKEN error on Windows;
                           icon size on macOS; missing author on Linux)
publish: null attempt   → all 3 platforms green, but latest.yml/latest-mac.yml/latest-linux.yml
                           missing from every platform's local build output (confirmed via the
                           workflow's own "Verify installer artifacts" log) — not shipped
Second v0.0.0-test run  → all 3 platforms green, correct assets present including all 3 update
                           manifests (gh release view --json assets)
npx tsc --noEmit -p .   → 0 errors (no src/ changes)
```

## Verification Steps

1. Pushed `v0.0.0-test`, watched the triggered run (`gh run watch --exit-status`) — all 3 legs failed at the build step.
2. Pulled per-platform failure logs (`gh run view --log-failed`) and diagnosed each of the three distinct causes above.
3. Fixed all three, re-pushed the tag (delete + recreate, since the first attempt's commit was already superseded) — run went green.
4. Before declaring success, explicitly listed the release's assets (`gh release view v0.0.0-test --json assets --jq '.assets[].name'`) rather than trusting the green run summary, and noticed the three `.yml` manifests were missing.
5. Traced that to `publish: null` disabling manifest generation entirely, fixed with `--publish=never` instead (config stays, upload is skipped via the CLI flag), re-pushed a third time.
6. Confirmed the final run's asset list included `latest.yml`/`latest-mac.yml`/`latest-linux.yml` alongside the installers.
7. Cleaned up in order: `gh release delete` → remote tag delete → local tag delete; confirmed `gh release list`/`git ls-remote --tags`/`git tag -l` all came back empty afterward.
