/**
 * @file electron/crawler-service.cjs
 *
 * Main-process owner of the web crawler (curated seed list, Phase 1-3 of the
 * crawler plan). Mirrors the `socket-owner.cjs` convention: init/dispose
 * lifecycle hooked into `main.cjs`'s `whenReady`/`before-quit`, control via
 * a single `ipcMain.handle` channel.
 *
 * The crawler's own logic is TypeScript (`src/browser/crawler/*.ts`,
 * compiled to `dist-main/` by `npm run build:crawler` — see tsconfig.main.json).
 * This file only owns the SQLite path, wires the TS classes together, and
 * exposes IPC actions; it has no crawling logic of its own.
 */

'use strict'

const { ipcMain, app } = require('electron')
const path = require('node:path')

const CHANNEL = 'nova:crawler'
const USER_AGENT = 'NovaCrawler/1.0 (+https://github.com/atharvasarpatwari/browser)'

let registered = false
let handleRef = null
let db = null
let fetcher = null
let robots = null
let scheduler = null
/** @type {Set<string>} hostnames of every seed added so far — the allow-list for link discovery. */
const allowedDomains = new Set()
let runPromise = null

function dbPath() {
  return path.join(app.getPath('userData'), 'web-index', 'crawler.db')
}

async function ensureStarted() {
  if (db) return
  const fs = require('node:fs')
  fs.mkdirSync(path.dirname(dbPath()), { recursive: true })

  const { CrawlerDb } = await import('../dist-main/browser/crawler/crawler-db.js')
  const { CrawlerFetcher } = await import('../dist-main/browser/crawler/crawler-fetcher.js')
  const { RobotsCache } = await import('../dist-main/browser/crawler/robots-cache.js')
  const { CrawlerScheduler } = await import('../dist-main/browser/crawler/crawler-scheduler.js')

  db = new CrawlerDb(dbPath())
  fetcher = new CrawlerFetcher()
  robots = new RobotsCache(db, (url) => fetchText(url), USER_AGENT)
  scheduler = new CrawlerScheduler(db, fetcher, robots, {
    userAgent: USER_AGENT,
    concurrency: 4,
    minDomainDelayMs: 500,
    allowedDomains,
  })
}

/** robots.txt fetch uses the same fetcher, trimmed to the {status, body} shape RobotsCache expects. */
async function fetchText(url) {
  try {
    const res = await fetcher.fetch(url, { userAgent: USER_AGENT, timeoutMs: 10_000 })
    return { status: res.status, body: res.body }
  } catch {
    return null
  }
}

async function handleRequest(payload) {
  await ensureStarted()

  switch (payload.action) {
    case 'addSeed': {
      const url = new URL(payload.url)
      allowedDomains.add(url.hostname)
      scheduler.enqueueSeed(url.toString())
      return { ok: true }
    }
    case 'start': {
      if (!runPromise) {
        runPromise = scheduler.run().finally(() => { runPromise = null })
      }
      return { ok: true }
    }
    case 'stop': {
      scheduler.stop()
      return { ok: true }
    }
    case 'stats': {
      return {
        ok: true,
        pagesFetched: scheduler.pagesFetchedCount,
        frontierSize: db.frontierSize(),
        documentCount: db.documentCount(),
        allowedDomains: [...allowedDomains],
        running: runPromise !== null,
      }
    }
    case 'search': {
      const limit = typeof payload.limit === 'number' ? payload.limit : 20
      return { ok: true, hits: db.search(payload.query, limit) }
    }
    default:
      throw new Error(`crawler-service: unknown action "${payload.action}"`)
  }
}

/** Register `ipcMain.handle('nova:crawler')`. Safe to call once per app run. */
function initNovaCrawlerService() {
  if (registered) return
  registered = true
  handleRef = ipcMain.handle(CHANNEL, (_event, payload) => {
    if (payload === null || typeof payload !== 'object' || typeof payload.action !== 'string') {
      throw new Error('crawler-service: malformed request payload')
    }
    return handleRequest(payload)
  })
  return handleRef
}

/** Stop the scheduler, close the database, drop the handler (app shutdown). */
function disposeNovaCrawlerService() {
  if (scheduler) scheduler.stop()
  if (db) db.close()
  db = null
  fetcher = null
  robots = null
  scheduler = null
  runPromise = null
  allowedDomains.clear()
  if (handleRef) {
    try { ipcMain.removeHandler(CHANNEL) } catch { /* never registered */ }
    handleRef = null
  }
  registered = false
}

module.exports = {
  initNovaCrawlerService,
  disposeNovaCrawlerService,
}
