'use strict'

const { app, BrowserWindow, Menu, nativeImage } = require('electron')
const path = require('path')
const url = require('url')
const fs = require('fs')

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const APP_TITLE = 'Nova Browser'

const HEALTH_LOG_PATH = path.join(__dirname, '..', 'nova-health.log')
const HEALTH_LOG_ENABLED = process.env.NOVA_HEALTH_LOG !== '0'

// ── Health log helpers ──────────────────────────────────────────────────────

function writeHealthLog(entry) {
  if (!HEALTH_LOG_ENABLED) return
  const line = `[${new Date().toISOString()}] ${entry}\n`
  try {
    fs.appendFileSync(HEALTH_LOG_PATH, line)
  } catch {
    /* log file unavailable — keep running */
  }
}

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
      webSecurity: false,
      nodeIntegration: true,
      contextIsolation: false,
      spellcheck: false,
      // The renderer resolves its persistent web-storage directory from argv
      // (see main.ts), avoiding main-only `app` APIs inside the renderer.
      additionalArguments: [`--nova-storage-dir=${path.join(app.getPath('userData'), 'web-storage')}`],
    },
  })

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
