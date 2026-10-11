# Open File, Show in Folder, and Retry — Wiring the Downloads Panel's Last Stubs

**Date:** 2026-10-01
**Session:** Closes the loop opened two sessions ago when investigating these exact stubs surfaced the bigger "downloads were fake" gap (fixed last session — real files now land on disk).
**Status:** Completed (0 root causes — feature wiring, not a bug fix)

---

## Summary

The downloads panel's "Open file" and "Show in folder" buttons were real no-ops (`case 'openFile': break;` / `case 'showInFolder': break;`), and failed downloads had no retry affordance at all. Both were deliberately deferred until real files existed on disk to open/show/retry against — they do now. Added a small `nova:shell` IPC channel (the renderer has no direct access to `electron.shell` under `contextIsolation: true`, and the only other `electron.shell` reference in the codebase compiles against a dev-time stub, never reaching the real module) following the exact pattern already established by `nova:net`, and a `DownloadManager.retry()` that restarts a failed download cleanly rather than attempting a risky partial-resume from possibly-invalid buffered bytes.

## What changed

- **`electron/main.cjs`**: new `ipcMain.handle('nova:shell', ...)` calling real `shell.openPath`/`shell.showItemInFolder`.
- **`electron/preload.cjs`**: bridges it as `window.nova.shell.openPath`/`.showItemInFolder`.
- **`src/browser/downloads/download-manager.ts`**: new `retry(id)` — only acts on a `'failed'` item, resets `receivedBytes`/`supportsResume`/`error` and discards any bytes buffered before the failure (deliberately not trusted — a failure could mean they're corrupt or the write genuinely never got that far), then restarts the fetch from scratch.
- **`src/ui/pages/downloads-page.ts`**: a retry button (🔄) now shows for `'failed'` items.
- **`src/ui/pages/browser-window.ts`**: the `downloadAction` switch's three previously-inert cases now call through to the above.

## Notes

- Buffered bytes from a failed attempt are intentionally discarded on retry rather than resumed — a failure during the write itself (the case this phase's own tests exercise) means the in-memory bytes were never proven to reach disk correctly; restarting the fetch is the safe default. A real network-interruption resume (keeping `supportsResume`/`receivedBytes` and sending a `Range` header) is what the existing `resume()` already does for a *paused* (not failed) download — `retry()` deliberately doesn't try to be a second resume path.
- `openFile`/`showInFolder`'s actual `electron.shell` round-trip has no automated test — same reasoning as the last two phases: there's no existing precedent for testing a `window.nova.*` IPC call, and it genuinely needs a real Electron main process. The real-pipeline `retry()` test is the automated proof for the one piece of this phase that could be tested without that.
- Added the new `shell` field to `NovaPreloadBridge` (`src/platform/shared/electron.d.ts`) for type-checking at the call sites — left the file's other, pre-existing staleness (missing `ipc`, unused `buffer`/`on`/`listeners`) untouched, out of scope here.

## Files Modified

| File | Change |
|------|--------|
| `electron/main.cjs` | New `nova:shell` IPC handle calling real `electron.shell.openPath`/`showItemInFolder` |
| `electron/preload.cjs` | Bridges it as `window.nova.shell.{openPath,showItemInFolder}` |
| `src/platform/shared/electron.d.ts` | Added the `shell` field to `NovaPreloadBridge` |
| `src/browser/downloads/download-manager.ts` | New `retry(id)` — clean restart of a failed download |
| `src/ui/pages/downloads-page.ts` | New retry button for `'failed'` items; `'retry'` added to the action type union |
| `src/ui/pages/browser-window.ts` | Wired the three previously-inert `downloadAction` cases |
| `tests/download-manager-disk.test.ts` | +2 tests: `retry()` restarts cleanly after a real failure and can succeed once the underlying problem is fixed; `retry()` is a no-op (`false`) on anything but a failed download |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 237/238 files, 9376/9379 tests (2 new; 3 unrelated pre-existing failures in tests/networking-integration.test.ts's DNS resolver suite — a file untouched by this change, confirmed failing in isolation due to this machine's `dns.lookup('localhost')` currently resolving to IPv6 `::1` rather than the IPv4 127.0.0.1 the test expects, an environment condition unrelated to this phase)
```

## Verification Steps

1. Real-pipeline tests (no mocks): a download that fails for a real reason (the same ENOTDIR-blocker trick from last session's tests), then `retry()`'d after the underlying problem is actually fixed, completes and writes the correct file content — proving `retry()` doesn't carry over stale buffered bytes, a stale error, or a stale `receivedBytes`; a second test confirms `retry()` returns `false` and does nothing for a non-failed item.
2. `openFile`/`showInFolder` need a real Electron window to verify (same class of limitation as the last two phases' live-preview checks) — not exercised automatically; the IPC wiring itself mirrors the already-proven `nova:net` pattern exactly.
3. Ran the full suite — 0 regressions in any file this phase touched; the only failures are the 3 pre-existing, environment-dependent DNS tests noted above.
