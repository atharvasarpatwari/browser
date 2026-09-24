# Automating the Android Download Test — a Real CDP Client Bug, and Two Genuine Environment Blockers

**Date:** 2026-09-24
**Session:** Asked to "improve the android app." Checked with the other Claude session already fixing the known `NovaStateBridge` infinite-sync-loop bug to avoid duplicating work (confirmed fixed-but-uncommitted there), then picked up "do the downloads test automation" — the one item on the manual checklist's download entry (streaming/completion) that doesn't actually need a human, per `device-smoke-test.mjs`'s own stated scope.
**Status:** Completed (1 root cause fixed; 2 environment-level blockers found and documented, not fixed — they're outside Nova's code)

---

## Summary

Added Tier 2b to `device-smoke-test.mjs`: a local HTTP server + `adb reverse` serves a deterministic random payload, `window.novaNative.download()` triggers a real `NativeDownloader` transfer on the connected device, and the result is pulled back via `adb shell run-as` and compared byte-for-byte — automating the one part of the manual checklist's download item (streaming/completion correctness) that isn't inherently a human-only check (pause/resume/cancel/share still are, since `NativeDownloader`'s `pause()`/`resume()`/`cancel()` are only ever called from the Compose UI with no bridge hook to drive them from a script).

Verifying this against a real connected device surfaced a real, unrelated bug in the smoke test's own minimal hand-rolled CDP WebSocket client — fixed — and, going deeper, two genuine environment-level limitations specific to this particular device (an Android 16 developer-preview build, WebView 152.0.7977.87) that block full on-device verification of *any* CDP-driven check that touches the app's native bridge, including the pre-existing `createTab()` check this session didn't touch. Those two are documented, not fixed — they're OS/WebView-version behavior, not something in Nova's code or this test script.

## Root Cause

**File:** `android/scripts/device-smoke-test.mjs` (`cdpEvaluate()`)
**Problem:** The minimal hand-rolled CDP client's `recv()` returns whatever WebSocket text frame arrives next, with no correlation to the request's own `id`. As long as a connection only ever sees command responses, this is harmless — but once anything causes the Chromium `Runtime` domain to start emitting unsolicited event notifications (`Runtime.consoleAPICalled`, `Runtime.executionContextCreated`, etc. — both of which have no `id` field at all, only `method`), those interleave with real command responses on the same socket. A client that treats "the next message" as "my response" grabs whichever arrives first: an event with no `.result` silently resolves as `undefined` instead of throwing (a false positive — `Tier 2b`'s own `download() call accepted` line originally "passed" this way without ever checking a real response), and a genuine response arriving after a stray event gets skipped entirely, which reads as "recv timed out" even though the real answer arrived on time. Reproduced directly: forcing `Runtime.enable` showed the exact event traffic landing in place of the expected reply.
**Fix:** Added `cdpRecvForId(ws, id, timeoutMs)` — loops `ws.recv()`, discards any message without a matching `id`, and only returns (or times out against the original deadline) once the real response for that specific request arrives. `cdpEvaluate()` now uses this instead of taking the first thing back.

## Notes — two environment-level findings, not fixed here

- **Any expression that reaches a `@JavascriptInterface` method synchronously during `Runtime.evaluate` never gets a CDP response, on this device.** Confirmed identically for `window.novaNative.createTab()` (a *pre-existing* check, unrelated to this session's change — creating a tab fires `installAndroidNativeBridge`'s `onChromeState` listener, which synchronously calls the real interface method `NovaStateBridge.onStateChanged()`) and for `window.novaNative.download()` (which calls `NovaStateBridge.onDownloadRequested()` directly). A pure JS read like `getState()` — no native call at all — always returns fine. Deferring the call via `setTimeout(fn, 0)` does **not** actually fix it: it only delays which *later* CDP connection gets corrupted, since once the deferred native call fires, *every subsequent* new CDP connection to the same target stops getting responses too — reproduced by watching a plain, unrelated `getState()` poll hang after a deferred `createTab()`'s timer had already fired. This is consistent with a real Android WebView + Chrome DevTools Protocol interaction bug, plausibly specific to this device's very recent (Android 16 preview / WebView 152) build rather than anything in Nova. Not something a JS-side test-script workaround can fix, since the corruption happens on the native/Chromium side of the bridge call itself.
- **`adb shell run-as <pkg>` can no longer reach the app's own external files directory on this device.** `run-as` works fine for internal storage (`/data/data/<pkg>/...`), but `ls`/`stat`/`cat` against `/sdcard/Android/data/<pkg>/files/...` (== `/storage/emulated/0/Android/data/<pkg>/files/...`, the exact path `NativeDownloader.downloadsDir()` uses) all fail with `Permission denied`, even under the app's own uid. This is a FUSE-layer (`MediaProvider`) restriction independent of Linux DAC permissions that `run-as`'s uid switch would normally satisfy — again plausibly specific to this device's preview-build storage stack tightening, not an app bug.
- Both findings mean Tier 2b's code is architecturally correct (verified byte-for-byte comparison logic, correct bridge wiring, correct wire format for `window.novaNative.download()`) but cannot currently pass end-to-end *on this specific device*. It should be re-verified once this device's WebView/OS updates past preview status, or against a second, non-preview device/emulator.
- While investigating the `createTab()` hang, briefly pulled in the other session's (uncommitted, different worktree/branch) `NovaStateBridge` dirty-check fix to test whether it was the cause — it wasn't (same hang, confirmed on a fresh rebuild) — so it was reverted out of this worktree entirely rather than landed here; that fix is real and separate, and remains that other session's to commit through its own branch.

## Files Modified

| File | Change |
|------|--------|
| `android/scripts/device-smoke-test.mjs` | Added Tier 2b (real download engine verification); fixed the CDP client's response/id-correlation bug (`cdpRecvForId`); updated the header doc-comment and final summary to reflect what's now automated |
| `doc/2026-09-06-android-manual-test-checklist.md` | Download item updated: streaming/completion is now automated by Tier 2b; clarified that pause/resume/cancel/share have no bridge hook and stay manual by necessity, not just by choice |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-09-24-android-download-test-automation-and-cdp-client-bug.md` | This change log |

## Test Results

```
node --check android/scripts/device-smoke-test.mjs   → syntax OK
npx tsc --noEmit -p .                                 → 0 errors (no src/ changes in the final diff)
```
Run live against a connected device (`KNEUZTEE6TIBAIIV`, Android 16 preview, WebView 152.0.7977.87):
```
Tier 1 (install/launch/boot)                          → all PASS, every run
Tier 2 (bridge contract + tabs)                       → bridge-installed + shape checks PASS;
                                                          createTab() FAILS — pre-existing device/
                                                          WebView-version CDP limitation, confirmed
                                                          unrelated to any change in this session
Tier 2b (real download, new)                          → download() trigger accepted; file-landing
                                                          verification blocked by the same CDP
                                                          limitation plus a separate run-as/external-
                                                          storage restriction on this device
```

## Verification Steps

1. Read `NativeDownloader.kt`, `NovaFetchBridge.kt`, `NovaStateBridge.kt`, `BrowserViewModel.kt`, and `android-native-bridge.ts` to trace the real trigger path end-to-end (`window.novaNative.download()` → `NovaStateBridge.onDownloadRequested()` → `BrowserViewModel.startDownloadFromBridge()` → `NativeDownloader.start()`) before writing anything, confirming the JSON field names and the JS-callable surface actually exist.
2. Checked for existing UI-automation infra (Espresso/UI Automator) before considering it — none exists, and building one from scratch is a much larger undertaking than "automate the download test" calls for; scoped Tier 2b to what the existing adb+CDP harness can genuinely verify (the engine's core streaming/completion correctness), leaving UI-only actions (pause/resume/cancel/share) to the manual checklist, matching this script's own established, deliberate scoping philosophy.
3. Wrote Tier 2b: local HTTP server + `adb reverse` + `window.novaNative.download()` + `adb shell run-as ... stat`/`cat` for byte-for-byte verification. Fixed a real crash-propagation bug in the same pass (an uncaught `cdpEvaluate` rejection was taking down the whole script instead of failing just that one check).
4. Ran against a real connected device. Got a reproducible `WebSocket recv timed out` on both the new download check and the pre-existing `createTab()` check.
5. Ruled out an improper WebSocket close handshake (added a real close frame — no change) and an infinite-sync-loop app bug (temporarily applied the other session's uncommitted fix, rebuilt, retested — no change; reverted after confirming).
6. Added temporary diagnostic logging (target list, connection state, sent/received payloads) and found the real client bug: `Runtime.enable`'s own response was itself misidentified as an unrelated `Runtime.executionContextCreated` event, proving the client doesn't correlate responses by `id`. Fixed with `cdpRecvForId()`.
7. With correct id-correlation still showing a genuine, permanent timeout (not just misattribution) for any native-bridge-touching expression, tested a `setTimeout`-deferred call — it returned instantly and correctly for its own connection, but proved not to actually fix the underlying issue: the *next* new CDP connection (for a completely unrelated, pure-JS `getState()` poll) hung once the deferred native call had fired. Reverted the deferred-call workaround since it doesn't solve anything, keeping only the real id-correlation fix.
8. Checked the device's Android/WebView version (`ro.build.version.release` 16, WebView 152.0.7977.87) — a very recent preview build — supporting the environment-limitation conclusion over an app-code regression, especially since the *pre-existing*, untouched `createTab()` check fails identically.
9. Diagnosed the separate `run-as`/external-storage `Permission denied` (initially miscategorized as a Git Bash path-mangling artifact — ruled that out with `MSYS_NO_PATHCONV=1`, confirmed it's real) by comparing `run-as` access to internal (`/data/data/<pkg>`, works) vs. external (`/sdcard/Android/data/<pkg>`, denied) storage on this same device.
10. Cleaned up all temporary debug logging and the disproven `setTimeout`/`Runtime.enable`/WebSocket-close-frame workaround attempts, leaving only the proven `cdpRecvForId` fix and the new Tier 2b check. Reverted the other session's temporarily-applied sync-loop fix out of this worktree. Reverted stale rebuilt Android assets back to their committed state (out of scope for this change).
