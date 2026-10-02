# Real Downloads-to-Disk (Phase 6b) — Every Download Was Fake

**Date:** 2026-09-28
**Session:** Investigating the downloads panel's `openFile`/`showInFolder`/`retry` stubs last session surfaced this bigger, undocumented gap underneath them.
**Status:** Completed (1 root cause fixed)

---

## Summary

`DownloadManager.startDownload()` fetched real bytes and accumulated them into a `chunks` array purely to track progress — the bytes were never written anywhere. Every "download" in the desktop app completed successfully, reported a `path`, and showed 100% progress, while no file ever existed on disk. Fixed by writing the accumulated bytes to a real file using the same `loadNodeBuiltin`-bridged `fs`/`path` pattern already proven in production by `DiskStorageBackend` (web storage), and by resolving a real default downloads directory (`app.getPath('downloads')`, handed down from Electron's main process via the same `additionalArguments` mechanism already used for the web-storage directory) instead of a meaningless relative `./downloads/...` string.

## Root Causes

1. **`DownloadManager` never persisted fetched bytes anywhere, and `DownloadItem.path` was never resolved against a real directory.** Fixed in four small, additive pieces: (a) `electron/main.cjs` now also passes `--nova-downloads-dir=${app.getPath('downloads')}` alongside the existing storage-dir flag; (b) `electron/preload.cjs` parses it into a new `processSnapshot.downloadsDir` field (the first real consumer of this `additionalArguments`-flag pattern — the pre-existing storage-dir flag turned out to have no renderer-side reader either, a separate, smaller version of the same gap, left untouched); (c) `src/app/main.ts` reads `window.nova.process.downloadsDir` and passes it into `DownloadManager`'s constructor, falling back to the existing relative default outside Electron (tests); (d) `DownloadManager` moved its per-download `chunks` array from a `startDownload()`-local variable to instance-level state (`chunksById`, matching the class's own existing per-id `speedTrackers` Map convention) — needed so a paused-then-resumed download's bytes survive across the resumed fetch's own fresh start — and after a real, non-paused/non-cancelled completion, concatenates them and writes the file via `fs.mkdirSync`+`fs.writeFileSync`, wrapped in the same try/catch the method already had (a write failure now correctly emits `downloadFailed` instead of falsely reporting `downloadCompleted`). The default filename is also now sanitized with `path.basename()` before joining, since it resolves to a real on-disk path.

## Notes

- **Buffering, not streaming, is the deliberate v1 choice** — `fs.createWriteStream()` has zero prior art anywhere in this codebase, and a `WriteStream` (an `EventEmitter` with internal handles) isn't proven to survive Electron's `contextBridge` marshaling the way plain functions/primitives are (nobody has tried it). Buffering the chunks that were already being accumulated for progress tracking, then one `writeFileSync`, reuses the exact tool `DiskStorageBackend` already trusts in production. Marked with a `ponytail:` comment naming the memory-usage ceiling and the upgrade path (a real streaming IPC, main-process `fs`) if multi-GB downloads ever become a real use case.
- The pre-existing `--nova-storage-dir` flag (for web storage) turned out to have the identical "looks wired, isn't" problem this investigation started with — main.cjs passes it, nothing on the renderer side ever reads it. Not fixed here; it's a separate, independent gap unrelated to downloads.
- `openFile`/`showInFolder`/`retry` (the original stubs that led to this investigation) are now genuinely wireable and demo-able, since `item.path` points at a real file — left as the natural next follow-up rather than bundled in here.
- Live dev-preview verification isn't available for this fix through the same browser-pane harness that hit the same limitation verifying the HttpOnly cookie fix last session — a plain browser tab has neither `window.nova` nor real `require`, so the disk-write path can only run in a real Electron window. The real-pipeline automated test (a real local HTTP server, a real temp directory, real `fs` assertions) is the actual proof of correctness.

## Files Modified

| File | Change |
|------|--------|
| `electron/main.cjs` | Added `--nova-downloads-dir=${app.getPath('downloads')}` to the renderer's `additionalArguments` |
| `electron/preload.cjs` | Parses the new flag into `processSnapshot.downloadsDir` |
| `src/app/main.ts` | `DownloadManager`'s DI factory reads the real downloads directory and passes it into the constructor |
| `src/browser/downloads/download-manager.ts` | Constructor accepts a base directory; `chunksById` replaces the per-call local `chunks` array; real `fs.mkdirSync`/`fs.writeFileSync` on completion (try/catch → `downloadFailed` on error); default path resolution sanitizes the filename via `path.basename()` |

## Files Created

| File | Purpose |
|------|--------|
| `tests/download-manager-disk.test.ts` | Real-pipeline (no mocks) coverage: a real local HTTP server, a real temp directory — the downloaded bytes actually exist on disk with the right content afterward; the default path resolves under the real base directory; a real write failure (ENOTDIR) transitions the item to `'failed'` instead of falsely reporting `'completed'` |
| `doc/2026-09-28-real-downloads-to-disk-implemented.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 238/238 files, 9377/9377 tests (3 new)
```

## Verification Steps

1. Real-pipeline tests (no mocks): downloaded from a real local HTTP server to a real `os.tmpdir()`-based directory; asserted the file exists on disk with the exact expected byte content; asserted a genuine write failure (a file blocking the expected directory path, forcing `mkdirSync` to throw `ENOTDIR`) correctly transitions the download to `'failed'` rather than lying about `'completed'`.
2. Confirmed the existing 70 `download-manager`/`download-manager-enhanced` tests still pass unmodified — none of them await real completion before asserting, so none exercised (or were broken by) the new disk-write path.
3. Ran the full suite (`npx tsc --noEmit -p .`, `npx vitest run`) — 0 regressions across all 238 files / 9377 tests.
4. Live dev-preview verification is not available through the browser-pane harness for this fix (see Notes) — the automated real-pipeline test is the actual proof of correctness, matching the same class of limitation hit verifying the previous HttpOnly cookie fix.
