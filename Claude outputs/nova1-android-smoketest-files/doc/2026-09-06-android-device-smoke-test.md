# Android — Automated On-Device Smoke Test (Tier 1 + Tier 2)

**Date:** 2026-09-06
**Session:** In response to "if i connect my mobile and run the android test
can you help me with it?" — there was no existing "android test" command
(`package.json` had no `android:test`/`android:smoke-test` script, and
TODO.md's own Android item explicitly says "no automated on-device test
harness exists yet"), so this session built one.
**Status:** Implemented, then **verified for real** the same day: the user
ran `npm run android:smoke-test` against their connected device
(`KNEUZTEE6TIBAIIV`) and all 8 checks passed, including the previously
untested hand-rolled WebSocket/CDP piece against the actual WebView devtools
endpoint (not just the local fake server used to build it). See "Real
device run" below for the full output. This session still has no shell/adb
access itself (file-bridge only) — the run happened on the user's machine,
relayed back here; see "What this session could not do" for what stays true
regardless.

---

## Summary

Added `android/scripts/device-smoke-test.mjs`, a dependency-free Node script
(`node android/scripts/device-smoke-test.mjs`, or `npm run
android:smoke-test`) that automates the part of the long-standing "manual
on-device feature pass" TODO item a script can verify honestly:

- **Tier 1** (`adb` + logcat + `dumpsys`): exactly one authorized device is
  attached, the debug APK installs, the app cold-launches
  (`am start -W` → `Status: ok`), the expected boot log lines appear
  (`[AndroidNativeBridge] Native host detected`, `onPageFinished` — the same
  markers `doc/2026-08-15-android-mobile-phase0-completeness.md` checked by
  hand), and the activity reaches the resumed/foreground state.
- **Tier 2** (Chrome DevTools Protocol over `adb forward`, scripting the same
  technique that doc used by hand): confirms `window.novaNative` actually
  exists (the JS engine booted, not just the Activity), sanity-checks the
  `ChromeStateSnapshot` shape (`tabs` array, `homeUrl`, `searchTemplate`),
  and does a real functional check of the tabs feature — calls
  `createTab()` and confirms the new tab shows up in the next state
  snapshot.

Deliberately **not** automated: long-press context menu, file upload,
permission dialogs, downloads (pause/resume/cancel/share), incognito
visuals, and light/dark theme rendering. Those involve real system UI or a
visual judgment call; driving them blindly via `adb shell input tap <x> <y>`
would be fragile and would test nothing real. Those are written up as an
explicit human checklist instead: `doc/2026-09-06-android-manual-test-
checklist.md`.

## Why a hand-rolled WebSocket client instead of a package

`ws` (or similar) isn't in `package.json`'s dependencies, and adding one for
a single utility script would mean the user has to `npm install` before this
works. Node's built-in `http` module handles the Upgrade handshake's HTTP
half (status line, header parsing) via its `'upgrade'` event; only the frame
*format* on top of that raw socket had to be written by hand — client
frames masked, server frames not, short (<126) and 16-bit-extended (126)
length prefixes. The 64-bit length prefix (127) is detected and rejected
with a clear error rather than mis-handled, since a CDP JSON reply for this
app's state snapshot will never be that large.

That framing logic was the one piece of this deliverable with real
correctness risk that unit-testing could actually catch without a device, so
it was tested: a throwaway local server (same doc, deleted after use)
exercised both the short-frame and the 126-length-prefix path end-to-end
over a real socket. First run caught a bug — in the *test server's* own
connection-scoped counter, not the shipped client — fixed, re-run, both
paths confirmed byte-correct. The client code committed here is the version
that passed that check.

## Real device run

The first real invocation hit one expected environment issue, not a bug in
the script: `adb` wasn't on the shell's PATH (`spawnSync adb ENOENT`) — the
script's own PATH check caught this cleanly and named the fix (`--adb
<path>` or add `platform-tools` to PATH) rather than crashing opaquely.
Confirmed via `android/local.properties`'s `sdk.dir` that the SDK — and so
`adb.exe` — is at `C:\Users\athar\AppData\Local\Android\Sdk\platform-tools\
adb.exe` on this machine. Re-run with `--adb` pointed there:

```
npm run android:smoke-test -- --adb "C:\Users\athar\AppData\Local\Android\Sdk\platform-tools\adb.exe"

Nova Browser — Android on-device smoke test
Tier 1 — adb, install, launch, boot verification
  [PASS] adb is reachable
  [PASS] device connected and authorized — KNEUZTEE6TIBAIIV
  [WARN] dist/ is newer than the installed APK — the app may not reflect your latest web build.
  [PASS] debug APK found — android/app/build/outputs/apk/debug/app-debug.apk (21.4 MB)
  [PASS] APK installed — adb install -r → Success
  [PASS] app launched — cold start 2804ms
  [PASS] boot log markers present — [AndroidNativeBridge] Native host detected / onPageFinished
  [PASS] activity is resumed (foreground)
Tier 2 — CDP bridge-contract + tabs check
  [PASS] window.novaNative bridge is installed
  [PASS] ChromeStateSnapshot shape looks right — 1 tab(s), homeUrl="about:blank"
  [PASS] createTab() is reflected in state — tabs 1 → 2
Summary
  All checks passed.
```

Same device (`KNEUZTEE6TIBAIIV`) as every prior Android session in this
repo. The one `[WARN]` is expected, not a failure: it's the same device this
session's earlier "dist/ newer than installed APK" staleness check was
built to catch — the installed APK predates the current `dist/`, so
`npm run build:android` before a future run would test the current web
build rather than whatever was last assembled. This confirms the
hand-rolled WebSocket/CDP client (see "Why a hand-rolled WebSocket client"
below) works against the real Chrome DevTools endpoint the WebView exposes,
not just the fake server it was built against — the one piece of this
deliverable that unit-testing alone couldn't settle.

## Files Created

| File | Purpose |
|------|---------|
| `android/scripts/device-smoke-test.mjs` | The smoke-test script (Tier 1 + Tier 2, described above) |
| `doc/2026-09-06-android-manual-test-checklist.md` | Human checklist for what Tier 1/2 deliberately don't automate |
| `doc/2026-09-06-android-device-smoke-test.md` | This changelog |

## Files Modified

| File | Change |
|------|--------|
| `package.json` | Added `"android:smoke-test": "node android/scripts/device-smoke-test.mjs"` |
| `doc/README.md` | Change Logs index row for this session; updated after the real device run to say so |
| `TODO.md` | Android item: split into an `[x]` automated slice (verified against the real device, see "Real device run") and a remaining `[ ]` manual-items bullet pointing at the checklist. Also corrected two now-stale sub-bullets under the Windows desktop item — see "Unrelated correction" below. |
| `tests/quic-transport.test.ts` | One stale comment fixed — see "Second unrelated correction" below |

## What this session could not do

No shell/adb access to the connected machine (file-bridge only) — this
session could not itself run the script, confirm the boot-marker strings,
`pidof`/`dumpsys` output shapes, or the `webview_devtools_remote_<pid>`
socket name against the real phone, or verify the CDP handshake/framing
against the real Chrome DevTools endpoint. All of that got covered anyway —
see "Real device run" above — because the user ran it and relayed the
output back, which is how every command in this repo that needs a real
shell has to happen from this side of the file bridge. Worth recording
regardless, since it's the reason this doc originally shipped without that
confirmation and had to be updated once the run came back.

## Unrelated correction (found while re-verifying networking-layer state)

Before starting the Android work, this session re-checked `ice-agent.ts`/
`quic-transport.ts`/`stun-client.ts`/`dgram-handle.ts`/`main.ts` against
`doc/README.md`'s Change Logs index, because a same-day entry
(`2026-09-06-socket-proxy-phase5-context-isolation.md`) turned up describing
Phase 5+6 work — a UDP dgram proxy rewire of those exact files plus the
`contextIsolation: true` flip — that this session hadn't seen before. Given
this repo's established pattern of concurrent-session drift, that was worth
checking rather than assuming: re-read the current on-device content of all
five files and confirmed the Buffer→Uint8Array follow-up from earlier this
session is correctly layered on top of the Phase 5 proxy architecture (which
is what its own updated header comments already claimed) — `ice-agent.ts`
still calls `getSocketProxy().openDgram()`, `stun-client.ts` and
`quic-transport.ts` have no raw `dgram`/`Buffer` usage left, and `main.ts`
still installs the page-world Buffer polyfill (still needed globally for
pngjs/base64/auto-updater — Phase 5's own doc says so — just no longer
needed by this specific UDP path). No conflict, no regression found.

That check also surfaced that TODO.md's item 2 (Windows desktop app) still
listed the Buffer-safe networking fix as "not yet implemented" and
`electron/preload.cjs` as dead code — both **superseded by Phase 5+6**
(`contextIsolation` is now `true`, `preload.cjs` was replaced wholesale and
is live, not dead). Corrected in TODO.md alongside the Android update above,
since it was found in the same pass.

## Second unrelated correction (found while updating this doc after the real device run)

While coming back to mark the smoke test verified, `doc/README.md`'s index
had gained another same-day entry since the first pass:
`2026-09-06-quic-wire-correctness.md`, fixing the exact three
`quic-transport.ts` wire-format bugs this session's own earlier
Buffer→Uint8Array work had documented (in that file's header, in
`tests/quic-transport.test.ts`'s header, and in `doc/socket-proxy-
design.md`'s Amendment section) as pre-existing and deliberately left alone.
Worth checking for the same reason as the first correction: that session's
own changelog states the encode-side byte layout for Initial/Handshake/
OneRtt is unchanged, so this session's "increments the packet number across
successive sends" test (the one with the hand-traced dual-offset
computation, added earlier this session after finding a bug in an
original shared-helper version) should still hold — read the current
`quic-transport.ts`, `quic-wire.ts`, and `tests/quic-transport.test.ts` to
confirm rather than assume.

The test and its offset logic are intact and still correct. One stale
leftover was found and fixed: a comment in the "sends a well-formed Initial
packet" test still called the type-tag scheme "(broken, see file header)"
even though the file header above it (rewritten by the fix session) now
says it's fixed — the assertion itself (`initial[0] === 0xC0`) still passed
only because Initial's type value happens to be `0x00` under both the old
and new bit-encoding, so nothing was functionally broken, just a
description of internals that no longer matched reality. Reworded to
describe the current `0xC0 | (type & 0x30)` scheme and note the coincidence.
`doc/socket-proxy-design.md`'s Amendment section was already correctly
updated by the fix session itself — no action needed there.
