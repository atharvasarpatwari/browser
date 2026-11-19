# QUIC Stream Writes Sent as One Giant UDP Datagram — Failed Outright on macOS

**Date:** 2026-09-23
**Session:** User pushed the merge-conflict-resolution work, then asked to re-run PR #1's failing CI checks. Two Rust jobs failed on a transient GitHub Actions cache-service outage (unrelated to this branch, cleared on its own). A third, `typecheck + vitest (macos-latest)`, failed for a real reason — asked to look into it.
**Status:** Completed (1 root cause fixed)

---

## Summary

`tests/quic-transport.test.ts`'s 20KB self-to-self round-trip test failed only on macOS CI (Ubuntu and Windows both passed the identical test) with `Error: send EMSGSIZE`, and the test's own assertion failed separately with `result.length` stuck at `0` instead of `20000` — the echoed data never came back because the send never went out. Root cause: `QuicConnection.sendStreamData()` puts the *entire* argument into one STREAM frame and sends it as a single UDP datagram, with no size cap at all. A 20KB write becomes a 20KB+ `sendto()` call. macOS's default `net.inet.udp.maxdgram` sysctl is 9216 bytes and rejects anything larger outright; Linux and Windows have looser defaults and tolerate it over loopback via IP fragmentation, so the same bug was invisible there. Real QUIC never relies on this — it always bounds each datagram at a sane size and splits a large stream write across multiple STREAM frames at increasing offsets, which this wire format's own STREAM frame already has a field for (`streamOffset`) — it just was never populated (hardcoded to `0`).

## Root Cause

**File:** `src/browser/networking/quic-transport.ts`
**Problem:** `sendStreamData()` called `buildStreamFrame(streamId, data, false)` once with the whole payload, and `buildStreamFrame()` always hardcoded the STREAM frame's offset field to `encodeVarInt(0)`. There was no upper bound on how large a single frame — and therefore a single UDP datagram — could be.
**Fix:** Added `MAX_STREAM_FRAME_PAYLOAD = 1200` (the conservative datagram size real QUIC stacks default to before path MTU discovery, comfortably under every OS's UDP limit including macOS's 9216-byte one). `buildStreamFrame()` now takes an optional `offset` parameter instead of hardcoding it. `sendStreamData()` loops over `data` in `MAX_STREAM_FRAME_PAYLOAD`-sized chunks, sending one packet per chunk with the correct running offset (a zero-length write still sends exactly one empty frame, matching the prior behavior). The decode side already parses `streamOffset` off the wire; it doesn't do offset-based reassembly (just appends each received frame to the stream's buffer in arrival order) — a pre-existing, documented simplification (this is "Nova's own QUIC-shaped format — NOT RFC 9000") that stays correct here since packets from one connection over loopback arrive in send order.

## Notes

- Confirmed via the actual CI logs (not guessed): the "Unhandled Rejection" stack trace pointed at `Channel._handleResponse`/`InProcessTransport.send` rather than anything QUIC-specific, which initially looked like a red herring — but `QuicConnection` opens its socket via `getSocketProxy().openDgram()`, the same IPC-channel-wrapped socket abstraction the rest of the networking layer uses even in-process, so a real `dgram.Socket.send()` EMSGSIZE from the OS genuinely does surface through that call stack. Traced it to the actual `socket.send(packet)` call in `sendPacket()` and from there to the unbounded single-frame write in `sendStreamData()`.
- Verified the total per-packet size stays far under any real limit: a 1200-byte frame payload plus the STREAM frame's own header (~9 bytes: type + streamId/offset/length varints) plus the QUIC long-header packet's own overhead (connection IDs + packet number) lands around 1210–1260 bytes total — nowhere near macOS's 9216-byte ceiling.
- Did not implement real offset-based reassembly (buffering out-of-order frames, gap detection) — out of scope for this fix and for this file's own documented scope ("Nova's own QUIC-shaped format"), and unnecessary since this connection class only ever talks to itself or a controlled peer over reliable, ordered loopback delivery in every current caller.
- Could not verify the fix against a real macOS runner directly (no macOS machine available); verified correctness locally (Windows) via the existing exact-byte STREAM-frame tests (small payloads still encode `offset=0`, since a small write fits in one chunk) and the 20KB round-trip test now fragmenting into ~17 packets and reassembling correctly. The real confirmation is the next `typecheck + vitest (macos-latest)` CI run on this PR.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/networking/quic-transport.ts` | Added `MAX_STREAM_FRAME_PAYLOAD` cap; `buildStreamFrame()` takes a real `offset` parameter; `sendStreamData()` fragments large writes across multiple packets instead of sending one unbounded datagram |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-09-23-quic-stream-frame-exceeded-macos-udp-datagram-limit.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run tests/quic-transport.test.ts tests/quic-wire.test.ts
  tests/networking-features.test.ts                       → 3 files / 63 tests passed
npx vitest run (full suite)                              → 229/229 files, 9339/9339 tests passed
npm run build:web                                        → built clean
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
```
Not yet confirmed on a real macOS runner — this branch's own CI will confirm on the next push.

## Verification Steps

1. Re-ran PR #1's failed CI checks (per user request); the two Rust jobs' failures traced to a live GitHub Actions cache-service outage (`sccache` hitting `artifactcache.actions.githubusercontent.com`, returning "Our services aren't available right now") — confirmed unrelated to this branch by inspecting the raw job logs directly via `gh api .../logs`.
2. `typecheck + vitest (macos-latest)` failed for a different, real reason. Pulled the failing job's log: `AssertionError: expected +0 to be 20000` in `tests/quic-transport.test.ts`'s 20KB round-trip test, plus an `Unhandled Rejection: Error: send EMSGSIZE`.
3. Traced the EMSGSIZE stack through `Channel`/`InProcessTransport` to `QuicConnection.sendPacket()`'s `this.socket.send(packet)` call, confirming `QuicConnection` opens its socket via the same `getSocketProxy().openDgram()` IPC-channel abstraction used elsewhere in the networking layer (explaining why an OS-level UDP error surfaces through IPC-looking frames).
4. Confirmed macOS's default UDP max-datagram-size (`net.inet.udp.maxdgram`, 9216 bytes) is the actual constraint being hit, and that `sendStreamData()` sent the entire 20KB payload as one frame/datagram with no size cap at all — a genuine protocol-correctness gap, not just a test-tuning issue.
5. Added `MAX_STREAM_FRAME_PAYLOAD` and reworked `sendStreamData()`/`buildStreamFrame()` to fragment large writes, using the wire format's own pre-existing (previously unused) offset field.
6. Verified the existing small-payload exact-byte STREAM-frame test still passes unchanged (offset stays 0 for a single-chunk write) and the 20KB round-trip test passes locally with the new multi-packet fragmentation path.
7. Ran the full verification suite (tsc, vitest 229/229, build, e2e 7/7) — all green.
