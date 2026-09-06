/**
 * @file electron/socket-owner.cjs
 *
 * Main-process terminal of the Nova socket-proxy wire (Phase 5 contextIsolation
 * migration). Mirrors `src/browser/networking/socket-owner.ts` — which runs
 * only inside tests / non-bridged runtimes — so the renderer never holds a live
 * `net`/`tls`/`dgram` socket under `contextIsolation: true`.
 *
 * Wire protocol (identical to the in-process owner):
 *
 *   requests  ipcRenderer.invoke('nova:net', { kind, socketId, ... })
 *   pushes    webContents.send('nova:net', { socketId, frame })
 *
 * Kinds: open-tcp | write | destroy | get-peer-certificate | upgrade-tls |
 *        open-dgram | dgram-bind | dgram-address | dgram-connect |
 *        dgram-send | dgram-close
 *
 * Bytes always cross as ArrayBuffers (structured clone), errors as plain
 * `{ message, name }` objects — the renderer's `toError` rehydrates them.
 */

'use strict'

const { ipcMain } = require('electron')
const net = require('net')
const tls = require('tls')
const dgram = require('dgram')

const CHANNEL = 'nova:net'
const WIRE_EVENTS = ['data', 'error', 'end', 'close', 'connect', 'secureConnect']

/** @type {Map<string, { socket: import('net').Socket, webContents: Electron.WebContents }>} */
const sockets = new Map()

/** @type {Map<string, { socket: import('dgram').Socket, webContents: Electron.WebContents, family: string, boundAddress: object|null }>} */
const dgrams = new Map()

/** The renderer that opened the socket — pushes are routed back to it. */
function senderOf(socketId) {
  const entry = sockets.get(socketId) || dgrams.get(socketId)
  return entry ? entry.webContents : null
}

/** Fire-and-forget push; a torn-down webContents silently drops the frame. */
function push(socketId, frame, webContents) {
  const wc = webContents || senderOf(socketId)
  if (!wc || wc.isDestroyed()) return
  try {
    wc.send(CHANNEL, { socketId, frame })
  } catch {
    /* webContents vanished mid-send — drop */
  }
}

/** Copy a Uint8Array/Buffer into a freshly-sized ArrayBuffer (wire form). */
function toArrayBuffer(bytes) {
  const copy = new Uint8Array(bytes.byteLength)
  copy.set(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))
  return copy.buffer
}

/**
 * `tls.connect` rejects numeric IP literals as `servername` (RFC 6066 forbids
 * IPs in SNI). Pass the host only when it looks like a DNS name.
 */
function ipOrUndefined(host) {
  return host.includes(':') || /^\d{1,3}(\.\d{1,3}){3}$/.test(host) ? undefined : host
}

/** Serialize an owner-side error into the plain `{message,name}` wire form. */
function errorWire(err) {
  const message = err && typeof err.message === 'string' ? err.message : String(err)
  const name = err && typeof err.name === 'string' ? err.name : 'Error'
  return { message, name }
}

// ─── TCP / TLS ───────────────────────────────────────────────────────────────

function openTcp(socketId, webContents, payload) {
  const socket = payload.tls
    ? tls.connect({
        host: payload.host,
        port: payload.port,
        servername: ipOrUndefined(payload.host),
        rejectUnauthorized: false,
      })
    : net.connect({ host: payload.host, port: payload.port })
  sockets.set(socketId, { socket, webContents })
  wire(socketId, socket, webContents)
  return { ok: true }
}

function wire(socketId, socket, webContents) {
  socket.on('data', (chunk) => push(socketId, { evt: 'data', bytes: toArrayBuffer(chunk) }, webContents))
  socket.on('error', (err) => push(socketId, { evt: 'error', error: errorWire(err) }, webContents))
  socket.on('end', () => push(socketId, { evt: 'end' }, webContents))
  socket.on('close', () => push(socketId, { evt: 'close' }, webContents))
  socket.on('connect', () => push(socketId, { evt: 'connect' }, webContents))
  socket.on('secureConnect', () => push(socketId, { evt: 'secureConnect' }, webContents))
}

function unwire(socket) {
  for (const evt of WIRE_EVENTS) socket.removeAllListeners(evt)
}

function requireSocket(socketId) {
  const entry = sockets.get(socketId)
  if (!entry) throw new Error(`socket-owner: unknown socket '${socketId}'`)
  return entry
}

function write(socketId, payload) {
  const entry = requireSocket(socketId)
  return new Promise((resolve, reject) => {
    entry.socket.write(Buffer.from(payload.bytes), (err) => {
      if (err) reject(new Error(err.message))
      else resolve({ ok: true })
    })
  })
}

function destroy(socketId) {
  const entry = sockets.get(socketId)
  sockets.delete(socketId)
  if (entry) {
    unwire(entry.socket)
    entry.socket.destroy()
  }
  return { ok: true }
}

/**
 * Wire-safe view of one certificate. `tls.getPeerCertificate(true)` links
 * `issuerCertificate` back to itself for roots — flatten it into an ordered
 * sibling `chain` array (leaf first) so the IPC serializer never sees a cycle.
 */
function encodeCertificateChain(raw) {
  const wire = (cert) => ({
    subject: cert.subject,
    issuer: cert.issuer,
    subjectaltname: cert.subjectaltname,
    valid_from: cert.valid_from,
    valid_to: cert.valid_to,
    serialNumber: cert.serialNumber,
    fingerprint: cert.fingerprint,
    fingerprint256: cert.fingerprint256,
    sigalg: cert.sigalg,
    pubkeyAlgorithm: cert.pubkey ? cert.pubkey.asymmetricKeyType : undefined,
    keySize: cert.pubkey ? cert.pubkey.asymmetricKeySize : undefined,
    basicConstraints: cert.basicConstraints,
    chain: [],
  })

  const chain = []
  const seen = new Set()
  let current = raw
  while (current && !seen.has(current)) {
    seen.add(current)
    chain.push(wire(current))
    current = current.issuerCertificate || null
  }
  return chain
}

function getPeerCertificate(socketId) {
  const entry = requireSocket(socketId)
  const fn = entry.socket && typeof entry.socket.getPeerCertificate === 'function'
    ? entry.socket.getPeerCertificate
    : null
  if (!fn) return { certificate: null }
  const raw = fn.call(entry.socket, true)
  if (!raw) return { certificate: null }
  const chain = encodeCertificateChain(raw)
  const certificate = chain.length > 0 ? Object.assign({}, chain[0], { chain }) : null
  return { certificate }
}

function upgradeTls(socketId, payload) {
  const entry = requireSocket(socketId)
  unwire(entry.socket)
  const tlsSocket = tls.connect({
    socket: entry.socket,
    servername: ipOrUndefined(payload.servername),
    rejectUnauthorized: false,
  })
  entry.socket = tlsSocket
  wire(socketId, tlsSocket, entry.webContents)
  return { ok: true }
}

// ─── UDP / dgram ─────────────────────────────────────────────────────────────

function openDgram(socketId, webContents) {
  const socket = dgram.createSocket('udp4')
  const entry = { socket, webContents, family: 'IPv4', boundAddress: null }
  dgrams.set(socketId, entry)
  wireDgram(socketId, entry)
  return { ok: true }
}

function wireDgram(socketId, entry) {
  entry.socket.on('message', (msg, rinfo) => {
    push(socketId, { evt: 'message', bytes: toArrayBuffer(msg), rinfo }, entry.webContents)
  })
  entry.socket.on('error', (err) => {
    push(socketId, { evt: 'error', error: errorWire(err) }, entry.webContents)
  })
  entry.socket.on('close', () => {
    push(socketId, { evt: 'close' }, entry.webContents)
  })
}

function requireDgram(socketId) {
  const entry = dgrams.get(socketId)
  if (!entry) throw new Error(`socket-owner: unknown dgram socket '${socketId}'`)
  return entry
}

function dgramBind(socketId, payload) {
  const entry = requireDgram(socketId)
  if (entry.boundAddress) return { ok: true, address: entry.boundAddress }
  return new Promise((resolve, reject) => {
    entry.socket.once('error', (err) => reject(new Error(err.message)))
    entry.socket.bind(payload.port, () => {
      const addr = entry.socket.address()
      const bound = { address: addr.address, family: addr.family, port: addr.port }
      entry.boundAddress = bound
      resolve({ ok: true, address: bound })
    })
  })
}

function dgramAddress(socketId) {
  return { address: requireDgram(socketId).boundAddress }
}

function dgramConnect(socketId, payload) {
  const entry = requireDgram(socketId)
  return new Promise((resolve, reject) => {
    entry.socket.once('error', (err) => reject(new Error(err.message)))
    entry.socket.connect(payload.port, payload.host, () => resolve({ ok: true }))
  })
}

function dgramSend(socketId, payload) {
  const entry = requireDgram(socketId)
  const bytes = Buffer.from(payload.bytes)
  return new Promise((resolve, reject) => {
    const cb = (err) => (err ? reject(new Error(err.message)) : resolve({ ok: true }))
    if (payload.port !== null && payload.port !== undefined && payload.address !== null && payload.address !== undefined) {
      entry.socket.send(bytes, payload.port, payload.address, cb)
    } else {
      entry.socket.send(bytes, cb)
    }
  })
}

function dgramClose(socketId) {
  const entry = dgrams.get(socketId)
  dgrams.delete(socketId)
  if (entry) {
    entry.socket.removeAllListeners()
    try { entry.socket.close() } catch { /* already closed */ }
  }
  return { ok: true }
}

// ─── Router ──────────────────────────────────────────────────────────────────

function route(socketId, webContents, payload) {
  switch (payload.kind) {
    case 'open-tcp': return openTcp(socketId, webContents, payload)
    case 'write': return write(socketId, payload)
    case 'destroy': return destroy(socketId)
    case 'get-peer-certificate': return getPeerCertificate(socketId)
    case 'upgrade-tls': return upgradeTls(socketId, payload)
    case 'open-dgram': return openDgram(socketId, webContents)
    case 'dgram-bind': return dgramBind(socketId, payload)
    case 'dgram-address': return dgramAddress(socketId)
    case 'dgram-connect': return dgramConnect(socketId, payload)
    case 'dgram-send': return dgramSend(socketId, payload)
    case 'dgram-close': return dgramClose(socketId)
    default: throw new Error(`socket-owner: unknown rpc '${String(payload.kind)}'`)
  }
}

// ─── Lifecycle ───────────────────────────────────────────────────────────────

let registered = false
let handleRef = null

/** Register `ipcMain.handle('nova:net')`. Safe to call once per app run. */
function initNovaSocketOwner() {
  if (registered) return
  registered = true
  handleRef = ipcMain.handle(CHANNEL, (event, payload) => {
    if (!event.sender || event.sender.isDestroyed()) return { ok: false }
    if (payload === null || typeof payload !== 'object' || typeof payload.socketId !== 'string') {
      throw new Error('socket-owner: malformed request payload')
    }
    return route(payload.socketId, event.sender, payload)
  })
  return handleRef
}

/** Drop the handler and destroy every live socket (app shutdown). */
function disposeNovaSocketOwner() {
  for (const socketId of [...sockets.keys()]) destroy(socketId)
  for (const socketId of [...dgrams.keys()]) dgramClose(socketId)
  if (handleRef) {
    try { ipcMain.removeHandler(CHANNEL) } catch { /* never registered */ }
    handleRef = null
  }
  registered = false
}

/** Tear down the sockets owned on behalf of one webContents (window closed). */
function cleanupNovaSocketsForWebContents(webContents) {
  for (const [socketId, entry] of [...sockets]) {
    if (entry.webContents === webContents) {
      sockets.delete(socketId)
      if (!entry.socket.destroyed) {
        unwire(entry.socket)
        entry.socket.destroy()
      }
    }
  }
  for (const [socketId, entry] of [...dgrams]) {
    if (entry.webContents === webContents) {
      dgrams.delete(socketId)
      entry.socket.removeAllListeners()
      try { entry.socket.close() } catch { /* already closed */ }
    }
  }
}

/** Diagnostic probe for the main-process health log / watchdog. */
function __novaNetProbe() {
  return {
    sockets: sockets.size,
    dgrams: dgrams.size,
    pid: process.pid,
    uptime: process.uptime(),
  }
}

module.exports = {
  initNovaSocketOwner,
  disposeNovaSocketOwner,
  cleanupNovaSocketsForWebContents,
  __novaNetProbe,
}