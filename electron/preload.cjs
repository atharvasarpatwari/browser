/**
 * @file electron/preload.cjs
 *
 * *** NOT CURRENTLY USED — dead code, kept only as reference. ***
 * `electron/main.cjs` no longer passes a `preload:` path (see the 2026-08-23
 * contextIsolation migration / 2026-08-28 revert:
 * doc/2026-08-28-windows-app-health-and-buffer-fix.md), and nothing else in
 * the repo references this file (checked electron-builder.yml too).
 *
 * It also would NOT actually fix the problem it was written for: `buffer.*`
 * below returns real Buffer instances across contextBridge, whose instance
 * methods do not survive structured cloning — the exact "Buffer is not
 * defined"-adjacent failure mode that broke the renderer in the first place.
 * A real contextIsolation-safe networking layer needs a different shape (see
 * doc/buffer-safe-networking-plan.md). Delete this file or replace it
 * wholesale when that work happens — don't extend it as-is.
 *
 * Electron preload script — runs in an isolated context with full Node.js
 * access and bridges critical APIs to the renderer via contextBridge.
 *
 * When contextIsolation is enabled, the renderer loses direct access to
 * require(), process, Buffer, and Node builtins. This script selectively
 * exposes them under the `window.nova` namespace.
 */

const { contextBridge } = require('electron')

/* -------------------------------------------------------------------------- */
/*  Controlled require — only loads known-safe Node builtins                   */
/* -------------------------------------------------------------------------- */

const ALLOWED_MODULES = new Set([
  'node:fs', 'fs',
  'node:path', 'path',
  'node:net', 'net',
  'node:tls', 'tls',
  'node:dns', 'dns',
  'node:dgram', 'dgram',
  'node:zlib', 'zlib',
  'node:crypto', 'crypto',
  'node:buffer', 'buffer',
  'node:stream', 'stream',
  'node:util', 'util',
  'node:events', 'events',
  'node:http', 'http',
  'node:https', 'https',
  'node:url', 'url',
  'node:os', 'os',
  'node:assert', 'assert',
])

function safeRequire(name) {
  if (!ALLOWED_MODULES.has(name)) {
    throw new Error(`nova.require: module '${name}' is not allowed by the preload allowlist`)
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require(name)
}

/* -------------------------------------------------------------------------- */
/*  Expose to renderer                                                        */
/* -------------------------------------------------------------------------- */

contextBridge.exposeInMainWorld('nova', {
  // Controlled module loader — mirrors the Node.js require API.
  require: safeRequire,

  // Minimal process info — avoids leaking the full process object.
  process: Object.freeze({
    platform: process.platform,
    arch: process.arch,
    pid: process.pid,
    version: process.version,
    versions: Object.freeze({ node: process.versions.node, chrome: process.versions.chrome, electron: process.versions.electron }),
    env: Object.freeze({ ...process.env }),
    // Event listener proxy — needed by process-guard.ts
    on: (event, handler) => process.on(event, handler),
    listeners: (event) => process.listeners(event),
    removeAllListeners: (event) => process.removeAllListeners(event),
  }),

  // Buffer factory — creates Buffer instances that are structured-clone-safe.
  buffer: Object.freeze({
    from: (data, encoding) => Buffer.from(data, encoding),
    alloc: (size, fill) => Buffer.alloc(size, fill),
    concat: (list, totalLength) => Buffer.concat(list, totalLength),
    isBuffer: (obj) => Buffer.isBuffer(obj),
  }),
})
