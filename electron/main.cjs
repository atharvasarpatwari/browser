'use strict'

const { app, BrowserWindow, Menu, nativeImage } = require('electron')
const path = require('path')
const url = require('url')

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL
const APP_TITLE = 'Nova Browser'

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
    },
  })

  if (DEV_SERVER_URL) {
    win.loadURL(DEV_SERVER_URL)
    win.webContents.openDevTools({ mode: 'detach' })
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))
  }

  win.on('page-title-updated', (event) => event.preventDefault())
  return win
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
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
