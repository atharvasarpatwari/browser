# Socket Proxy Design — contextIsolation-safe networking

**Date:** 2026-09-04
**Session:** Phase 1 (design gate) of the buffer-safe networking implementation
**Status:** Approved design — implementation follows in Phases 2–6
**Depends on:** `doc/buffer-safe-networking-plan.md` (scope + problem analysis)

---

## Summary

This document specifies the IPC socket-proxy architecture that lets Nova's networking
layer run under `contextIsolation: true`. The renderer never touches a real
`net.Socket`, `tls.TLSSocket`, or `dgram.Socket` — the **main process owns every live
socket**, and the renderer gets thin `ISocketHandle` / `IDgramHandle` wrappers whose
methods are IPC RPC calls and whose events arrive as push messages. This is the piece
`buffer-safe-networking-plan.md` identified as the required prerequisite for every
"Problem 2" (socket-holding) file.

---

## Grounding facts (verified this session)

### Test harness does NOT prove contextIsolation safety
`vitest.config.ts` uses `environment: 'happy-dom'` and aliases `electron` →
`tests/helpers/electron-mock.ts`. Networking tests (`networking-http-proxy.test.ts`,
etc.) `import * as http from 'node:http'` and reach real sockets directly. **The entire
suite runs with full `Buffer`/`require`/`net` access.** Green tests therefore prove
socket *logic* but prove **nothing** about the proxied path. This is the single biggest
verification gap — the design mandates new proxy-wire integration tests.

### Socket-owning files (verified greps; non-exhaustive per file)
| File | Buffers | Real socket usage |
|------|--------|-------------------|
| `raw-socket-http-client.ts` | 14 | `net.connect`, `tls.connect`, `tls.connect({socket})`, `.on('data')`, `.getPeerCertificate` |
| `socket-reader.ts` | 22 | wraps a `Socket`, wires 4 listeners, `.detach()` re-emits leftovers |
| `http-proxy-connect.ts` | 2 | returns `Promise<Socket>`; `tls.connect`/`net.connect`; `socket.emit('data', leftover)` |
| `socks-connection.ts` | 28 | same tunnel shape as HTTP CONNECT |
| `ice-agent.ts` | 4 (+1 dgram) | `dgram.createSocket('udp4')`, `.on('message')` |
| `quic-transport.ts` | 75 | `dgram.createSocket('udp4')`, heaviest byte-framing |
| `tls-handler.ts` | — | TLS negotiation (consumes `getPeerCertificate`) |

### Byte-only files (Problem 1, no sockets — Phase 2)
`content-encoding.ts`, `http-auth.ts`, `multipart.ts`, `request-manager.ts` (mixed
orchestrator — its 4 `Buffer` uses are leaf logic), `stun-client.ts` (byte logic
consumed by `ice-agent`).

---

## Design decision 1 — two proxy shapes, one wire protocol

TCP/TLS and UDP are different enough that forcing one interface on both is wrong.

- **TCP/TLS** — connect/secureConnect/lookup semantics; ordered byte stream; TLS
  upgrade mid-life; peer-certificate inspection. → `ISocketHandle`.
- **UDP/dgram** — no connect/secure events, only `bind`/`send`/`message`/`error`/`close`;
  datagram-oriented. → `IDgramHandle`.

Both reuse the same **channel + topic-push** wire model below, but expose different
renderer interfaces and different main-side owners.

---

## Design decision 2 — wire protocol over the existing IPC Channel

Per the approved decision (reuse `Channel` + `JSONSerializer`; per-byte binary is
accepted for MVP). No new transport is introduced.

- **RPC (request/response)**: `Channel.request(payload)`. Used for
  `connect` / `write` / `send` / `bind` / `destroy` / `getPeerCertificate` /
  `upgradeTls`. Each socket gets its own `socketId`; payloads carry it.
- **Push events (fire-and-forget)**: `Channel.subscribe(topic, handler)` +
  `Channel.send(topic, payload)`. Main → renderer for `data`/`message`/`error`/
  `close`/`secureConnect`. Bytes are carried as `Uint8Array` → the existing
  `JSONSerializer` `arraybuffer` tag (per-byte `Array.from`) — acceptable for MVP,
  to be optimized later with a binary serializer if profiling demands.
- **One shared channel** between renderer and main for all socket proxies, e.g.
  `nova:net`. Socket identity is by `socketId` in the payload.

Transport choice: in Electron production this is the `EventEmitterTransport`/IPC bridge
(from `electron/main.cjs` ↔ `electron/preload.cjs`); in tests it is `InProcessTransport`
(identical semantics, so proxy-wire integration tests are representative).

---

## Design decision 3 — TLS upgrade is main-side, not a nested proxy

`raw-socket-http-client.ts:235` does `tls.connect({ socket: rawSocket, ... })` to wrap an
already-established tunneled connection in TLS. With the renderer holding only
`ISocketHandle`, `tls.connect` cannot operate on the handle (it needs a real `net.Socket`).

**Resolution:** the proxy protocol includes `upgradeTls(socketId, servername)` — an RPC
that tells main to run `tls.connect({ socket: mainSocket, servername, rejectUnauthorized:
false })` on its real socket. The renderer's `ISocketHandle` remains the same object; it
now emits `secureConnect` and `data` (decrypted) events. After TLS upgrade,
`getPeerCertificate(socketId)` returns the cert main observed.

This keeps ALL native socket state main-side and avoids the impossible nested-proxy design.

---

## Design decision 4 — leftover-buffer re-emission is local, not round-tripped

`http-proxy-connect.ts:152-153`: after `performConnectHandshake`, `reader.detach()`
returns buffers the proxy consumed but the downstream stream should still see, and the
current code re-emits them via `socket.emit('data', leftover)`.

With a proxied socket, re-emitting means **re-sending bytes to main and having main push
them back** — wasteful but, worse, a correctness hazard (byte reordering vs. live
decrypted data frames). Resolution: `ISocketHandle` gains a renderer-local
`enqueueIncoming(bytes: Uint8Array)` that appends to the handle's local inbound buffer and
dispatches to locally-registered `data` handlers. `SocketReader.detach()` is reworked to
hand leftovers to the handle via this method instead of `socket.emit`. No round-trip.

---

## Design decision 5 — `SocketReader` and tunnel helpers return/consume `ISocketHandle`

- `SocketReader` currently `private readonly socket: Socket`. Rework its constructor to
  accept an `ISocketHandle` and subscribe to its events (`onData`/`onError`/`onEnd`/
  `onClose`) instead of `socket.on('data', ...)`. Its `readUntil`/`read` return
  `Uint8Array` (bytes already local).
- `connectThroughHttpProxy(...)` and `connectThroughSocks(...)` change their return type
  from `Promise<Socket>` to `Promise<ISocketHandle>`. The handshake writes go through
  `handle.write(...)`.
- `raw-socket-http-client.ts` collects `chunks: Uint8Array[]` from `handle.onData`, and
  for TLS uses `handle.upgradeTls(...)` + `handle.getPeerCertificate()` instead of
  `tls.connect`/`socket.getPeerCertificate`.

---

## Exported contracts (new `src/browser/networking/socket-handle.ts` + `dgram-handle.ts`)

```ts
// TCP/TLS — renderer side
interface ISocketHandle {
  readonly id: string;
  write(bytes: Uint8Array): Promise<void>;
  destroy(): Promise<void>;
  getPeerCertificate(): Promise<unknown>;
  upgradeTls(servername: string): Promise<void>;   // main-side TLS wrap
  enqueueIncoming(bytes: Uint8Array): void;        // local re-emit (Design 4)

  onEvent(evt: 'data' | 'error' | 'end' | 'close' | 'secureConnect',
          handler: (payload: Uint8Array | Error | undefined) => void): () => void;
}

// UDP/dgram — renderer side
interface IDgramHandle {
  readonly id: string;
  bind(port?: number, address?: string): Promise<void>;
  send(bytes: Uint8Array, port: number, address: string): Promise<void>;
  close(): Promise<void>;
  onEvent(evt: 'message' | 'error' | 'close',
          handler: (payload: { data: Uint8Array; rinfo: { address: string; port: number } } | Error | undefined) => void): () => void;
}
```

Renderer obtains these through a small factory backed by the channel, e.g.
`socketProxy.openTcp(host, port)`, `socketProxy.openDgram()`.

---

## Main-side owner (new CJS module; kept OUT of `electron/main.cjs`)

`electron/socket-owner.cjs` (plain CJS, `require('electron').ipcMain`): holds a
`Map<socketId, { socket: net.Socket | tls.TLSSocket | dgram.Socket, session }>`, registers
the `nova:net` channel, and:

- RPC handlers: `openTcp`, `write`, `destroy`, `getPeerCertificate`, `upgradeTls`,
  `openDgram`, `bind`, `dgramSend`, `dgramClose`.
- Event forwarder: on each live socket's `data`/`message`/`error`/`end`/`close`/
  `secureConnect`, pushes the corresponding topic message to the renderer channel.
- Cleanup: on `destroy`/`close`/window close, removes listeners and releases the handle,
  preventing leaks.

---

## Preload bridge (replaces dead `electron/preload.cjs` wholesale)

The current preload is documented dead code and must NOT be extended. The fresh preload
exposes only:

```js
contextBridge.exposeInMainWorld('nova', {
  ipc: { on: (channel, cb) => ipcRenderer.on(channel, cb),
         send: (channel, data) => ipcRenderer.send(channel, data) },
  process: { platform, arch, pid, version, env: {...process.env},   // read-only, frozen
             on/removeAllListeners for process-guard.ts },
  requireSafe: safeAllowlistedRequire,   // node:zlib etc. for byte-only codecs
});
```

`loadNodeBuiltin` (node-builtins.ts) is updated so the `contextIsolation` path returns
this narrower surface; live `net`/`tls`/`dgram` module instances are NO LONGER handed
across (they can't work anyway), so renderer code must go through `socketProxy` instead.

---

## File-by-file plan (from plan doc + corrected scope)

| Phase | Files | Change |
|-------|-------|--------|
| 2 | `content-encoding.ts`, `http-auth.ts`, `multipart.ts`, `request-manager.ts`, `stun-client.ts` | Buffer → Uint8Array (byte-only; no proxy needed) |
| 3 | `socket-handle.ts` (new), `socket-proxy.ts` (new), `socket-reader.ts`, `http-proxy-connect.ts`, `raw-socket-http-client.ts` | Introduce `ISocketHandle` + TCP proxy; rework the three consumers |
| 4 | `socks-connection.ts`, `tls-handler.ts` | Same TCP-proxy shape |
| 5 | `dgram-handle.ts` (new), `ice-agent.ts`, `quic-transport.ts` | `IDgramHandle` UDP proxy |
| 6 | `electron/main.cjs`, `electron/preload.cjs`, `electron/socket-owner.cjs` (new), `node-builtins.ts` | Flip `contextIsolation: true`; wire the channel + preload |

`content-encoding.ts`'s caller (`raw-socket-http-client`) moves in lockstep per the plan
doc — its `ContentDecoder.decode()` returns `Uint8Array` and the call site drops
`.toString('utf-8')` in favor of a `TextDecoder`.

---

## Verification (Phase 6 + per-phase gates)

Per AGENTS.md Run & Verify, each phase commits only after `npm run typecheck` (0 errors)
and the relevant vitest slice is green. Phase 6 additionally runs the full suite + app.

New proxy-wire integration test (`tests/socket-proxy.test.ts`) using the
`createInProcessPair`/`Channel` harness (mirrors `ipc-advanced.test.ts`) — **this closes
the verification gap**: it drives `RawSocketHttpClient` through the actual
`ISocketHandle` proxy path against a real local TCP/TLS server, so a regression in the
IPC proxy is caught even though the rest of the suite runs with full `Buffer` access.

Full Phase-6 pass: `npm run typecheck`, `npm test`, `npm run electron:start` (health-log
watchdog: `APP_READY` + `ALIVE`), `npm run build:win` + installed-app launch.

---

## Explicitly out of scope (documented, deferred)
- Binary-fast serializer for large socket payloads (MVP accepts per-byte JSON arrays).
- Multi-process socket ownership (this is the single-process main-as-owner model). If a
  future architecture moves networking into a dedicated worker process, the `socketId` +
  topic-push protocol is transport-agnostic and should survive mostly unchanged.
- `dgram`/QUIC fine-grained optimizations.
