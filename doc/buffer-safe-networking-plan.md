# Buffer-Safe Networking Layer — Plan

**Date:** 2026-09-03 (revised same day — see "Revision note" below)
**Session:** Scoping the long-term fix for the Windows blank-window bug's underlying trade-off (see `2026-08-28-windows-app-health-and-buffer-fix.md`, `TODO.md` item 2)
**Status:** Planned — not implemented. No code in `src/browser/networking/` was touched. File-bridge-only access to this machine both times this doc was written — no build/test run performed, no typecheck run.

---

## Revision note

The first version of this doc (same date, earlier session) scoped this as a single problem — "`Buffer` instances lose their prototype methods crossing `contextBridge`, so switch to `Uint8Array`/`DataView`" — and estimated it as a 155-occurrence, 7-file, mostly-mechanical rewrite. That was **incomplete in a way that matters**: it's true for files that only move bytes around, but false for files that hold and operate on a live `net.Socket`/`tls.TLSSocket` instance, which is a bigger problem than `Buffer` and isn't fixed by swapping types. See "Two different problems" below — this revision splits the file list accordingly and corrects the recommendation. Caught before any code was written, by actually tracing what the low-risk-looking files depend on rather than trusting the grep counts alone.

## Overview

`electron/main.cjs` currently runs with `nodeIntegration: true, contextIsolation: false` because `src/browser/networking/*` uses the bare Node `Buffer` global directly (`Buffer.alloc`, `.writeUInt32BE`, `.subarray`, `.toString(encoding)`, etc.). Under `contextIsolation: true`, the renderer's isolated world has no `Buffer`, `require`, or `process` globals at all — code that references them directly throws `ReferenceError` at the point of use, which is the literal blank-window crash documented in `2026-08-28-windows-app-health-and-buffer-fix.md`. That's the root cause the 08-28 fix worked around by disabling `contextIsolation` instead of fixing the underlying dependency. This doc scopes what actually fixing it would take, so `nodeIntegration: true` doesn't stay the permanent posture by default.

## Two different problems, not one

**Problem 1 — bare `Buffer` global usage.** Any file that calls `Buffer.alloc(...)`, `Buffer.from(...)`, `Buffer.concat(...)`, or a `Buffer`-instance method (`.writeUInt32BE`, `.toString(encoding)`, `.subarray()` returning a `Buffer`) directly is dead on arrival under `contextIsolation: true` — `Buffer` simply won't exist in that scope. This is fixable with `Uint8Array` + `DataView` + a couple of small pure-JS helpers (hex/base64/latin1 codecs — `TextEncoder`/`TextDecoder` cover UTF-8 natively, and both are standard web-platform APIs, unaffected by `contextIsolation`, already available in any Electron renderer). `Electron`'s `contextBridge` *does* support plain `ArrayBuffer`/`TypedArray` via the standard structured-clone algorithm, so once a file stops touching `Buffer`, it stops caring whether `contextIsolation` is on.

**Problem 2 — live `net.Socket`/`tls.TLSSocket` instances.** This is the one the first version of this doc missed. `net.connect()`/`tls.connect()` return a `Socket`, an `EventEmitter` subclass wrapping a native handle (file descriptor / OS-level connection state). Under `contextIsolation: true`, obtaining `net`/`tls` at all means going through the `window.nova.require` bridge (`node-builtins.ts`'s existing dual-path loader) — a function call proxied across `contextBridge`. Electron's `contextBridge` proxies *functions* live and structured-clones *data*, but a `Socket` instance is neither: it's a stateful class instance with a native handle that cannot be structurally cloned and has no meaningful "proxy" semantics for the way this codebase uses it — holding a reference in a class field (`SocketReader`'s `private readonly socket`), registering/removing multiple listeners over its lifetime (`.on('data', ...)`, `.removeListener(...)`), and calling `.write()`/`.destroy()` on demand. **Swapping `Buffer` for `Uint8Array` in these files does not make them `contextIsolation`-compatible** — the socket itself can't cross the boundary in the first place. Fixing this for real means an IPC-proxy architecture: the main process owns the actual socket, and the renderer gets a thin wrapper object whose methods send IPC messages (`connect`/`write`/`destroy`) and whose `data`/`error`/`close` "events" arrive via `ipcRenderer.on` forwarding — a genuinely different design, not a rewrite of the existing classes.

### Which files are which

| File | Occurrences (grep) | Problem | Fixable with Uint8Array/DataView alone? |
|------|---------------------|---------|-------------------------------------------|
| `content-encoding.ts` | 10 | 1 only — wraps `zlib`, no sockets | Yes, in isolation — **but see coupling note below** |
| `http-proxy-connect.ts` | 2 | 1 **and** 2 — holds/returns a `Socket` (`connectThroughHttpProxy` returns `Promise<Socket>`) | No — needs the IPC-proxy work first |
| `socket-reader.ts` | 12 | 1 **and** 2 — wraps a `Socket` directly, wires 4 listeners in its constructor | No — needs the IPC-proxy work first |
| `raw-socket-http-client.ts` | 14 | 1 **and** 2 — calls `socket.on('data', ...)` directly, owns the connection lifecycle | No — needs the IPC-proxy work first |
| `socks-connection.ts` | 27 | 1 **and** 2 (SOCKS tunneling is socket-based, same shape as the HTTP CONNECT path) | No — needs the IPC-proxy work first |
| `multipart.ts` | 18 | 1 only, not yet traced for coupling — needs the same caller-check `content-encoding.ts` got before assuming it's safe | Probably, pending that check |
| `quic-transport.ts` | 72 | 1 **and** 2 — QUIC is UDP-based (`node:dgram`), same live-socket-handle problem, worse: `dgram.Socket` plus the heaviest byte-framing code in the whole layer | No — needs the IPC-proxy work first, and is the largest/riskiest file either way |

Only `content-encoding.ts` (confirmed) and tentatively `multipart.ts` (not yet checked) are actually just Problem 1. The other five are Problem 2, and Problem 2 isn't scoped by this doc at all yet — it needs its own design pass (an IPC socket-proxy shape, likely modeled on how `ipc-advanced.test.ts`'s existing IPC system already does channel-based message passing elsewhere in this codebase — worth checking before designing a new mechanism from scratch).

## `content-encoding.ts`'s caller coupling (found during this revision)

`content-encoding.ts`'s `ContentDecoder.decode()`/`decodeFromString()` are typed `Promise<Buffer>`, and its **only** caller in the codebase (grepped, not exhaustive beyond what's been read) is `raw-socket-http-client.ts` line 350, which does `decoded.toString('utf-8')` on the result — a `Buffer`-only method. `raw-socket-http-client.ts` is itself deep in Problem 2 (it owns the socket directly) and is thoroughly `Buffer`-typed end to end (`bodyRaw: Buffer`, `decodeChunkedBody(raw: Buffer): Buffer`, `Buffer.concat(chunks)` on raw socket data, etc. — 14 of its own occurrences).

That means `content-encoding.ts` **cannot actually be fixed in isolation** the way the original plan's "start with the smallest files" order assumed: changing its return type to `Uint8Array` breaks its only caller at compile time (`Uint8Array.prototype.toString()` takes no `encoding` argument — TS would reject `decoded.toString('utf-8')`), and leaving its return type as `Buffer` while removing internal `Buffer.alloc`/`Buffer.from` calls is incoherent — the method's signature would promise a `Buffer` it can no longer construct without the same bare-global problem. `content-encoding.ts` is genuinely low-risk *content*, but it isn't a genuinely low-risk *starting point* — its one caller needs to move in lockstep, and that caller is entangled with Problem 2. Corrected suggested order below reflects this.

## Revised suggested order

1. **Design the IPC socket-proxy shape first.** Nothing in the "socket-holding" column can move until this exists — attempting file-by-file conversion without it (as the original plan assumed) would produce files that compile in isolation but still crash the instant `contextIsolation: true` is flipped on, exactly the kind of "verified in the diff, broken at runtime" gap a 9000-test suite won't necessarily catch if the tests themselves run under `nodeIntegration: true` (worth checking how `raw-socket-http-client.test.ts`-equivalent tests are actually run before assuming green tests mean this is safe).
2. Once that shape exists: `content-encoding.ts` and the relevant lines of `raw-socket-http-client.ts` move together, in the same change — not as separate "easy" and "hard" phases. Same likely applies to `multipart.ts` once its caller is checked the same way `content-encoding.ts`'s was.
3. `http-proxy-connect.ts` + `socket-reader.ts` together (they're already tightly coupled — `performConnectHandshake` constructs a `SocketReader` directly).
4. `socks-connection.ts` — same socket-tunnel shape as step 3, do after that path is proven out once.
5. `quic-transport.ts` last — largest, uses `dgram` instead of `net`/`tls` (a third API surface the IPC-proxy design needs to cover, not just a bigger version of the same thing), and has the most byte-framing logic to get subtly wrong.
6. Only after all of the above: flip `electron/main.cjs` back to `nodeIntegration: false, contextIsolation: true`, restore a `preload:` entry (a fresh one — `electron/preload.cjs` as it exists today is dead code, see `TODO.md`), and re-run the same verification pass documented in `2026-08-28-windows-app-health-and-buffer-fix.md` / `2026-09-01-make-app-functional.md` (`npm run typecheck`, full `npm test`, `npm run electron:dev`, `npm run build:win` + installed-app launch with the health-log watchdog).

## Explicitly not done

No code in `src/browser/networking/` was changed, in either version of this doc. The occurrence-count table is grep output, not a verified call-site-by-call-site audit — re-run it before starting. The IPC socket-proxy design referenced in step 1 does not exist yet as a doc or code; this file only names the need for it. `multipart.ts`'s caller(s) have not been checked the way `content-encoding.ts`'s was — do that before assuming it's a Problem-1-only file. This entire plan was written and revised without a working `npm run typecheck` / `npm test` loop (file-bridge-only machine access) — treat every claim above about what would or wouldn't compile as reasoned-through, not verified.
