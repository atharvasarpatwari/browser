/**
 * @file electron/secure-store.cjs
 *
 * Main-process-only OS-keychain encryption for secrets the renderer needs to
 * persist (currently: the Anthropic API key used by nova://research). Mirrors
 * the ipcMain.handle registration pattern in socket-owner.cjs.
 *
 * The renderer never touches safeStorage directly — contextIsolation means it
 * can't anyway. It sends plaintext/ciphertext strings over IPC and gets a
 * string back; the Buffer <-> base64 conversion happens here.
 */

'use strict'

const { ipcMain, safeStorage } = require('electron')

const CHANNEL = 'nova:secure-storage'

function encrypt(value) {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'unavailable' }
  const buf = safeStorage.encryptString(value)
  return { ok: true, value: buf.toString('base64') }
}

function decrypt(value) {
  if (!safeStorage.isEncryptionAvailable()) return { ok: false, error: 'unavailable' }
  try {
    const plain = safeStorage.decryptString(Buffer.from(value, 'base64'))
    return { ok: true, value: plain }
  } catch (err) {
    return { ok: false, error: String(err && err.message || err) }
  }
}

let registered = false
let handleRef = null

/** Register `ipcMain.handle('nova:secure-storage')`. Safe to call once per app run. */
function initNovaSecureStore() {
  if (registered) return
  registered = true
  handleRef = ipcMain.handle(CHANNEL, (_event, payload) => {
    if (payload === null || typeof payload !== 'object' || typeof payload.value !== 'string') {
      throw new Error('secure-store: malformed request payload')
    }
    if (payload.action === 'encrypt') return encrypt(payload.value)
    if (payload.action === 'decrypt') return decrypt(payload.value)
    throw new Error(`secure-store: unknown action '${String(payload.action)}'`)
  })
  return handleRef
}

function disposeNovaSecureStore() {
  if (handleRef) {
    try { ipcMain.removeHandler(CHANNEL) } catch { /* never registered */ }
    handleRef = null
  }
  registered = false
}

module.exports = {
  initNovaSecureStore,
  disposeNovaSecureStore,
}
