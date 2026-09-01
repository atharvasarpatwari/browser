'use strict'

const { app, BrowserWindow, Menu, nativeImage, session } = require('electron')
const path = require('path')
const url = require('url')
const fs = require('fs')

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const APP_TITLE = 'Nova Browser'

const HEALTH_LOG_ENABLED = process.env.NOVA_HEALTH_LOG !== '0'

// Health log target. In dev/unpacked the write next to main.cjs (project root)
// is fine, but when packaged __dirname points inside the read-only app.asar,
// so resolve to a writable per-user location instead. app.getPath('userData')
// is only valid after app is ready, hence the lazy getter.
function healthLogPath() {
  if (app.isPackaged) {
    try {
      return path.join(app.getPath('userData'), 'nova-health.log')
    } catch {
      // userData unavailable (very early) — fall back to a relative path
      return path.join(__dirname, '..', 'nova-health.log')
    }
  }
  return path.join(__dirname, '..', 'nova-health.log')
}

// ── Health log helpers ──────────────────────────────────────────────────────

function writeHealthLog(entry) {
  if (!HEALTH_LOG_ENABLED) return
  const line = `[${new Date().toISOString()}] ${entry}\n`
  try {
    fs.appendFileSync(healthLogPath(), line)
  } catch {
    /* log file unavailable — keep running */
  }
}

// ── Process-level resilience ────────────────────────────────────────────────
// Renderer crashes were already handled (render-process-gone / unresponsive
// below), but nothing caught a main-process-level exception — an uncaught
// throw or rejection here would take the whole app down silently. Log and
// keep running, matching the renderer side's "recover, don't die" approach.

process.on('uncaughtException', (err) => {
  console.error('[Nova] Uncaught exception in main process:', err)
  writeHealthLog(`MAIN_UNCAUGHT_EXCEPTION error=${err && err.message ? err.message : String(err)}`)
})

process.on('unhandledRejection', (reason) => {
  const message = reason && reason.message ? reason.message : String(reason)
  console.error('[Nova] Unhandled rejection in main process:', reason)
  writeHealthLog(`MAIN_UNHANDLED_REJECTION reason=${message}`)
})

function resolveIcon() {
  const candidates = [
    path.join(__dirname, '..', 'build', 'icon.png'),
    path.join(__dirname, '..', 'build', 'icon.ico'),
    path.join(__dirname, '..', 'assets', 'icon.png'),
  ]
  for (const candidate of candidates) {
    try {
      const image = nativeImage.createFromPath(candidate)
      if (!image.isEmpty()) return image
    } catch {
      /* keep trying */
    }
  }
  return undefined
}

// ── Security hardening ─────────────────────────────────────────────────────

function installSecurityPolicies(win) {
  // 1. Content-Security-Policy: restrict sources for scripts, styles, etc.
  //    Nova's renderer loads arbitrary URLs, so we allow * for connect/img/media
  //    but restrict script/style/object to 'self' + inline (needed for engine).
  const CSP_DIRECTIVES = [
    "default-src 'self' https: http:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https: http:",
    "media-src 'self' https: http:",
    "connect-src 'self' https: http: wss: ws:",
    "font-src 'self' data: https:",
    "object-src 'none'",
    "frame-src 'none'",
    "base-uri 'none'",
    "form-action 'self' https: http:",
  ].join('; ')

  win.webContents.session.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'content-security-policy': [CSP_DIRECTIVES],
        'x-content-type-options': ['nosniff'],
        'x-frame-options': ['DENY'],
        'referrer-policy': ['strict-origin-when-cross-origin'],
      },
    })
  })

  // 2. Block top-level navigation away from the app (phishing prevention).
  win.webContents.on('will-navigate', (event, navigationUrl) => {
    const parsed = new URL(navigationUrl)
    const appUrl = DEV_SERVER_URL || `file://${path.join(__dirname, '..', 'dist', 'index.html')}`
    const appParsed = new URL(appUrl)
    if (parsed.origin !== appParsed.origin) {
      console.warn(`[Nova] Blocked top-level navigation to ${parsed.origin}`)
      writeHealthLog(`NAVIGATION_BLOCKED url=${parsed.origin}`)
      event.preventDefault()
    }
  })

  // 3. Block new window / popup creation (use tabs instead).
  win.webContents.setWindowOpenHandler(({ url: openUrl }) => {
    console.warn(`[Nova] Blocked new window: ${openUrl}`)
    writeHealthLog(`NEW_WINDOW_BLOCKED url=${openUrl}`)
    return { action: 'deny' }
  })

  // 4. Block permissions for sensitive APIs (camera, mic, geolocation, etc.)
  //    unless explicitly allowed by the engine's capability system.
  win.webContents.session.setPermissionRequestHandler((_webContents, permission, callback) => {
    // Allow clipboard and notifications — deny everything else at Electron level.
    // Nova's own permission system handles camera/mic/geolocation for web content.
    const allowed = ['clipboard-read', 'clipboard-sanitized-write', 'notifications']
    if (allowed.includes(permission)) {
      callback(true)
    } else {
      writeHealthLog(`PERMISSION_DENIED perm=${permission}`)
      callback(false)
    }
  })

  // 5. Restrict keyboard shortcuts that could bypass the engine's controls.
  win.webContents.on('before-input-event', (event, input) => {
    // Block Ctrl/Cmd+Shift+I (DevTools toggle) in production.
    if (!DEV_SERVER_URL && input.control && input.shift && input.key.toLowerCase() === 'i') {
      event.preventDefault()
    }
  })

  writeHealthLog('SECURITY_POLICIES_INSTALLED')
}

// ── Watchdog state ──────────────────────────────────────────────────────────

let mainWindow = null
let watchdogTimer = null
let unresponsiveTimer = null
let rendererCrashed = false
let quitting = false

const WATCHDOG_INTERVAL_MS = 5000
const PROBE_TIMEOUT_MS = 2000
const UNRESPONSIVE_ESCALATION_MS = 15000

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    title: APP_TITLE,
    icon: resolveIcon(),
    backgroundColor: '#1e1e1e',
    webPreferences: {
      // MVP: the Nova engine implements its own security layer (SOP, CSP,
      // sandbox) and fetches arbitrary URLs itself, so we relax the host
      // webview. Harden via main-process net routing in a later release.
      //
      // nodeIntegration: true + contextIsolation: false is required because
      // the engine's networking stack uses the bare Node `Buffer` global
      // (Buffer.alloc/writeUInt32BE/subarray, etc.) throughout. Electron's
      // contextBridge cannot hand a functional Buffer to the page (instance
      // methods don't survive the bridge — verified empirically), so the
      // 08-23 contextIsolation migration left the renderer crashing at boot
      // with "Buffer is not defined" before mounting any UI. See
      // 2026-08-28-windows-app-health-and-buffer-fix.md — this restores the
      // config the codebase was designed for (tier4/build-security decision),
      // while the CSP / navigation / permission protections below remain.
      webSecurity: false,
      nodeIntegration: true,
      contextIsolation: false,
      spellcheck: false,
      // The renderer resolves its persistent web-storage directory from argv
      // (see main.ts), avoiding main-only `app` APIs inside the renderer.
      additionalArguments: [`--nova-storage-dir=${path.join(app.getPath('userData'), 'web-storage')}`],
    },
  })

  installSecurityPolicies(win)

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.on('page-title-updated', (event) => event.preventDefault())

  // Crash resilience: recover instead of dying silently.
  win.webContents.on('render-process-gone', (_event, details) => {
    const reason = details ? details.reason : 'unknown'
    console.error(`[Nova] Renderer process gone: ${reason}`)
    writeHealthLog(`RENDERER_GONE reason=${reason}`)
    rendererCrashed = true
    if (mainWindow && !mainWindow.isDestroyed()) {
      try {
        mainWindow.reload()
        writeHealthLog(`RENDERER_RELOADED after=${reason}`)
      } catch (err) {
        writeHealthLog(`RENDERER_RELOAD_FAILED error=${err.message}`)
      }
    }
  })

  win.webContents.on('unresponsive', () => {
    console.warn('[Nova] Renderer unresponsive')
    writeHealthLog('RENDERER_UNRESPONSIVE')
    // Escalate after a grace period: reload to reclaim the UI.
    unresponsiveTimer = setTimeout(() => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        writeHealthLog('RENDERER_UNRESPONSIVE_ESCALATE reload')
        mainWindow.reload()
      }
    }, UNRESPONSIVE_ESCALATION_MS)
  })

  win.webContents.on('responsive', () => {
    if (unresponsiveTimer) {
      clearTimeout(unresponsiveTimer)
      unresponsiveTimer = null
    }
    writeHealthLog('RENDERER_RESPONSIVE')
  })

  win.webContents.on('did-fail-load', (_event, errorCode, errorDescription) => {
    console.error(`[Nova] Failed to load: ${errorCode} ${errorDescription}`)
    writeHealthLog(`LOAD_FAILED code=${errorCode} desc=${errorDescription}`)
  })

  win.on('closed', () => {
    if (unresponsiveTimer) {
      clearTimeout(unresponsiveTimer)
      unresponsiveTimer = null
    }
    mainWindow = null
    writeHealthLog('WINDOW_CLOSED')
  })

  return win
}

function probeRenderer(win) {
  return new Promise((resolve) => {
    let settled = false
    const done = (result) => {
      if (!settled) {
        settled = true
        resolve(result)
      }
    }
    const timer = setTimeout(() => done({ alive: false, reason: 'timeout' }), PROBE_TIMEOUT_MS)
    win.webContents
      .executeJavaScript(
        'globalThis.__novaHealthProbe ? globalThis.__novaHealthProbe() : (document.getElementById("browser-app") != null)',
        true
      )
      .then((result) => {
        clearTimeout(timer)
        done({ alive: true, result })
      })
      .catch((err) => {
        clearTimeout(timer)
        done({ alive: false, reason: err && err.message ? err.message : String(err) })
      })
  })
}

async function runWatchdog() {
  if (mainWindow && mainWindow.isDestroyed()) {
    writeHealthLog('WINDOW_DESTROYED recreate')
    mainWindow = createWindow()
    return
  }

  if (!mainWindow) {
    writeHealthLog('NO_WINDOW recreate')
    mainWindow = createWindow()
    return
  }

  if (mainWindow.webContents.isCrashed()) {
    writeHealthLog('RENDERER_CRASHED reload')
    rendererCrashed = true
    mainWindow.reload()
    return
  }

  const probe = await probeRenderer(mainWindow)
  if (probe.alive) {
    writeHealthLog(`ALIVE probe=${JSON.stringify(probe.result)}`)
  } else {
    writeHealthLog(`UNRESPONSIVE reason=${probe.reason}`)
    if (!rendererCrashed) {
      rendererCrashed = true
      mainWindow.reload()
    }
  }
  rendererCrashed = false
}

function startWatchdog() {
  if (watchdogTimer) return
  watchdogTimer = setInterval(() => {
    runWatchdog().catch((err) => {
      writeHealthLog(`WATCHDOG_ERROR error=${err && err.message ? err.message : String(err)}`)
    })
  }, WATCHDOG_INTERVAL_MS)
}

function stopWatchdog() {
  if (watchdogTimer) {
    clearInterval(watchdogTimer)
    watchdogTimer = null
  }
  if (unresponsiveTimer) {
    clearTimeout(unresponsiveTimer)
    unresponsiveTimer = null
  }
}

// ── Auto-update ──────────────────────────────────────────────────────────
// Guarded: electron-updater is a new dependency (see package.json) that may
// not be installed yet in every checkout, and update checks only make sense
// for a packaged build pointed at a real GitHub release, never in dev. Never
// let this block app startup — log and move on if anything here fails.

function setupAutoUpdater() {
  if (!app.isPackaged || DEV_SERVER_URL) {
    writeHealthLog('AUTO_UPDATE_SKIPPED reason=dev-or-unpackaged')
    return
  }

  let autoUpdater
  try {
    ;({ autoUpdater } = require('electron-updater'))
  } catch (err) {
    writeHealthLog(`AUTO_UPDATE_UNAVAILABLE error=${err && err.message ? err.message : String(err)}`)
    return
  }

  autoUpdater.logger = null
  autoUpdater.autoDownload = false

  autoUpdater.on('checking-for-update', () => writeHealthLog('AUTO_UPDATE_CHECKING'))
  autoUpdater.on('update-available', (info) => writeHealthLog(`AUTO_UPDATE_AVAILABLE version=${info.version}`))
  autoUpdater.on('update-not-available', () => writeHealthLog('AUTO_UPDATE_UP_TO_DATE'))
  autoUpdater.on('error', (err) => writeHealthLog(`AUTO_UPDATE_ERROR error=${err && err.message ? err.message : String(err)}`))
  autoUpdater.on('update-downloaded', (info) => writeHealthLog(`AUTO_UPDATE_DOWNLOADED version=${info.version}`))

  autoUpdater.checkForUpdates().catch((err) => {
    writeHealthLog(`AUTO_UPDATE_CHECK_FAILED error=${err && err.message ? err.message : String(err)}`)
  })
}

function installApplicationMenu() {
  const isMac = process.platform === 'darwin'
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    { role: 'fileMenu' },
    { role: 'editMenu' },
    { role: 'viewMenu' },
    { role: 'windowMenu' },
    { role: 'help', submenu: [{ role: 'about' }] },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

app.setName(APP_TITLE)

app.whenReady().then(() => {
  installApplicationMenu()
  mainWindow = createWindow()
  writeHealthLog('APP_READY')
  startWatchdog()
  setupAutoUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      mainWindow = createWindow()
      writeHealthLog('WINDOW_CREATED activate')
    }
  })
})

app.on('window-all-closed', () => {
  // Keep-alive: recreate the window so the browser stays open. The watchdog
  // also recreates it on the next tick if a race slips past this handler.
  if (quitting) return
  writeHealthLog('WINDOW_ALL_CLOSED recreate')
  if (app.isReady()) {
    mainWindow = createWindow()
  } else if (process.platform !== 'darwin') {
    app.quit()
  }
})

app.on('before-quit', () => {
  quitting = true
  stopWatchdog()
  writeHealthLog('APP_QUIT')
})
