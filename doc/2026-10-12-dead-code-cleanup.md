# Dead Code Cleanup — Acting on the 2026-10-11 Audit

**Date:** 2026-10-12
**Session:** Deleted the repo-wide dead/orphaned code identified by the 2026-10-11 ponytail-audit (`TODO.md` §5a), after re-verifying every item since a day had passed and two items had genuinely changed status.
**Status:** Completed

---

## Summary

Re-verified reachability for all 15 originally-flagged items before deleting anything, since status can drift. Found two real changes from the original audit: `src/browser/extensions/` is no longer dead (the 2026-10-12 session wired its core into the DI container), and `src/browser/image/` was never actually dead — a grep-based reachability check missed a relative-path import from the live rendering engine, caught by `tsc` immediately after deletion and restored. Everything else was confirmed still unreachable and removed, along with two files/references the original audit missed entirely (`src/native/http-client.ts`, `src/browser/accessibility/index.ts`).

## What was deleted

- `src/browser/rendering/pipeline/` — the 9-module shadow render pipeline + its 9 test files. Only consumer was `src/benchmark/suites/index.ts`.
- `new/analytics.html` — stale duplicate of `doc/analytics.html`.
- `src/browser/navigation-controls/`, `src/browser/devtools/`, `src/browser/credentials/`, `src/browser/omnibox/`, `src/browser/pdf-viewer/` — each with zero importers, confirmed again today.
- `src/browser/web-apis/web-apis-permissions.ts` — required surgically trimming two `describe` blocks out of `tests/security-runtime-enforcement.test.ts` (which otherwise tests live CSP/CORS code) rather than deleting that test file wholesale.
- `src/browser/accessibility/screen-reader.ts` + its `index.ts` barrel — the barrel re-exported nothing but screen-reader and had no importers of its own once `devtools/accessibility-panel.ts` (its only consumer, also dead) was gone.
- `mini-browser-android/` — the separate, unintegrated Kotlin+Compose Android app.
- `native/nova-net/src/http.rs` + `native/nova-bindings/src/http.rs` + `src/native/http-client.ts` (the `NovaHttpClient` TS wrapper — not previously named in the audit, found by tracing the dead chain end-to-end). Removed the `http` Cargo feature from both native crates, trimmed the matching `describe('NovaHttpClient', ...)` block out of `tests/native/native-bindings.test.ts`, and updated `package.json`'s `native:build:*` scripts plus `.github/workflows/native-build.yml` to stop requesting the now-nonexistent `http` feature.
- `src/ui/pages/settings-page.ts` — removed the entire "Browser Menu" settings section (22 `menuShow*` + `menuSidebarAutohide` + `menuDefaultZoom`), read by zero code anywhere.

**96 files changed, 20,169 lines removed.**

## What was excluded, and why

- **`src/browser/extensions/`** — no longer dead. The 2026-10-12 session wired `ExtensionLoader`/`Permissions`/`manifest.ts` into `main.ts` and built `nova://extensions`. The remaining unwired pieces (`messaging.ts`, `storage-api.ts`, `content-scripts.ts`, `background-scripts.ts`) are the natural next increment of that same feature — actually executing installed extensions — not abandoned code.
- **`src/browser/media/permission-manager.ts`** vs. `security/permission-manager.ts` — left as a separate, still-open TODO item. This is a consolidation task (two overlapping implementations, one of them live), not a deletion.

## A real mistake, caught before it shipped

The original audit found zero importers for `src/browser/image/` via `grep -rl "browser/image" src | grep -v own-dir`. That grep missed `src/browser/rendering/lazy-loader.ts`, which imports it as `../image/decoder` — a relative path containing neither `browser/` nor `image` as a contiguous substring matching the search. `lazy-loader.ts` is itself used by `page-renderer.ts`, the live rendering engine. Deleting `image/` broke `tsc` immediately (`Cannot find module '../image/decoder'`), which is exactly why the verification step exists — restored the directory and its test file, and reverted the three npm dependencies (`pngjs`, `jpeg-js`, `@stacksjs/ts-webp` — the last one a genuine dynamic `import()` at runtime, not just a type-only import) that had also been removed from `package.json` on the mistaken assumption the module was dead.

**Lesson for next time:** a substring grep for reachability is a good first pass but can miss relative imports. Re-running `tsc --noEmit` immediately after each deletion batch (not just at the end) is what actually caught this — worth doing that ordering deliberately rather than batching all deletions before the first verification.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/pages/settings-page.ts` | Removed the dead "Browser Menu" settings section |
| `tests/security-runtime-enforcement.test.ts` | Removed the 2 `describe` blocks exercising `web-apis-permissions.ts`, kept the live CSP/CORS/secure-context tests |
| `tests/native/native-bindings.test.ts` | Removed the `describe('NovaHttpClient', ...)` block and its now-unused imports |
| `native/nova-net/Cargo.toml`, `native/nova-net/src/lib.rs` | Removed the `http` feature and its `http = "1"` dependency |
| `native/nova-bindings/Cargo.toml`, `native/nova-bindings/src/lib.rs` | Removed the mirrored `http` feature |
| `package.json` | Dropped `http` from the 4 `native:build:*` feature lists |
| `.github/workflows/native-build.yml` | Dropped `http` from the test matrix and (commented-out) build steps |

## Files Deleted
96 files across `src/browser/{rendering/pipeline,navigation-controls,devtools,credentials,omnibox,pdf-viewer,web-apis,accessibility/screen-reader.ts+index.ts}`, `src/native/http-client.ts`, `new/`, `mini-browser-android/` (whole app), `native/{nova-net,nova-bindings}/src/http.rs`, and their paired test files (see `TODO.md` §5a for the full itemized list with line counts).

## Test Results
```
npx tsc --noEmit                        # 0 errors
npx eslint src tests                    # 0 new errors (4 pre-existing errors found in
                                           tests/ipc.test.ts / ipc-advanced.test.ts, files
                                           this cleanup never touched)
npx vitest run (full suite)             # 205/205 files, 8663/8663 tests, exit 0
                                           (down from 221 files/9223 tests pre-cleanup —
                                           the ~16 test files for deleted modules)
cargo check -p nova-net --features dns  # clean
```

## Verification Steps

1. Re-verified reachability for all 15 originally-flagged items (not just trusted the 2-day-old audit) via `grep` for direct imports, then cross-checked against dynamic `import()`/`require()` — caught the `extensions/` status change this way.
2. Deleted via `git rm` (not raw `rm -rf`) so every removal is a tracked, revertible change.
3. Ran `tsc --noEmit` immediately after the first deletion batch — caught both the `image/` false-positive and the orphaned `accessibility/index.ts` barrel before they could compound.
4. Attempted `cargo check --features dns,tls` on the native workspace: `nova-net` itself checked clean; the `tls` feature build failed on a pre-existing `ring`/gcc toolchain issue in this sandbox (unrelated — the audit only touched the `http` module, not `tls`/`rustls`), and `nova-bindings` failed on a pre-existing missing-`libnode.dll` build-script issue on this machine (fails before reaching any Rust source, let alone the lines this session edited). Both limitations are environment-specific, not caused by this change; noted here rather than silently claimed as passing.
5. Full `npx vitest run` across the repo — 205/205 files, 8663/8663 tests, exit code 0.
