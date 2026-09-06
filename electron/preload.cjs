/**
 * @file electron/preload.cjs
 *
 * Boundary between the isolated Electron renderer and the main process
 * (Phase 5 contextIsolation migration, see doc/socket-proxy-design.md).
 *
 * Exposes three things on `window.nova`:
 *
 *   ipc     — the nova:net socket-proxy transport. `request` round-trips an
 *             RPC over ipcRenderer.invoke; `on` relays webContents.push
 *             frames ({ socketId, frame } envelopes) and returns an
 *             unsubscribe. The renderer never touches net/tls/dgram.
 *   require — controlled loader for the read-only Node builtins the renderer
 *             still legitimately needs. Narrow allowlist: fs/path/crypto/
 *             zlib/dns/os/tls. No net, no dgram — sockets are proxy-only.
 *   process — frozen snapshot for diagnostics only. Deliberately exposes no
 *             `on`/`listeners`, so src/browser/engine/process-guard.ts takes
 *             its window.onerror browser branch (a bare `process` global is
 *             never installed, so `typeof process === 'undefined'` holds).
 *
 * Buffer is intentionally absent: the page world gets its Buffer from
 * src/browser/buffer-polyfill.ts instead of a bridged Node Buffer.
 */

'use strict'

const { contextBridge, ipcRenderer } = require('electron')

const CHANNEL = 'nova:net'

/* -------------------------------------------------------------------------- */
/*  Controlled require — only the builtins the renderer resolves at runtime    */
/* -------------------------------------------------------------------------- */

const ALLOWED_MODULES = new Set([
  'node:fs', 'fs',
  'node:path', 'path',
  'node:crypto', 'crypto',
  'node:zlib', 'zlib',
  'node:dns', 'dns',
  'node:os', 'os',
  'node:tls', 'tls',
])

function safeRequire(name) {
  if (!ALLOWED_MODULES.has(name)) {
    throw new Error(`nova.require: module '${name}' is not allowed by the preload allowlist`)
  }
  return require(name)
}

/* -------------------------------------------------------------------------- */
/*  ipc — nova:net socket-proxy transport                                     */
/* -------------------------------------------------------------------------- */

const ipcBridge = Object.freeze({
  request(payload) {
    return ipcRenderer.invoke(CHANNEL, payload)
  },
  on(handler) {
    const listener = (_event, envelope) => handler(envelope)
    ipcRenderer.on(CHANNEL, listener)
    return () => ipcRenderer.removeListener(CHANNEL, listener)
  },
})

/* -------------------------------------------------------------------------- */
/*  process — frozen diagnostics snapshot, no event-surface                   */
/* -------------------------------------------------------------------------- */

const processSnapshot = Object.freeze({
  platform: process.platform,
  arch: process.arch,
  pid: process.pid,
  version: process.version,
  versions: Object.freeze({
    node: process.versions.node,
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  }),
  env: Object.freeze(Object.assign({}, process.env)),
})

/* -------------------------------------------------------------------------- */
/*  Expose                                                                     */
/* -------------------------------------------------------------------------- */

contextBridge.exposeInMainWorld('nova', {
  ipc: ipcBridge,
  require: safeRequire,
  process: processSnapshot,
})