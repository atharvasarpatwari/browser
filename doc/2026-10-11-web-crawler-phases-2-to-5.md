# Web Crawler — Phases 2-5 (link extraction, scheduler, Electron wiring, settings UI, nova://search)

**Date:** 2026-10-11
**Session:** Phases 2-5 of the in-app web crawler + search index plan (`C:\Users\athar\.claude\plans\buzzing-dazzling-stream.md`), continuing from Phase 1 (`doc/2026-10-11-web-crawler-phase1-foundation.md`)
**Status:** Completed (Phase 6 — PageRank, SimHash dedup, adaptive re-crawl, JS rendering — remains deliberately deferred, as scoped in the plan)

---

## Summary

Built on top of Phase 1's storage/robots/fetch foundation: link extraction, the crawl scheduler (politeness, dedup, link discovery within a curated allow-list), the main-process build pipeline and `electron/crawler-service.cjs` wiring, a renderer-side client + `nova://search` "From the web (crawled)" section, and a Settings → Web Index section for adding seed sites and controlling the crawl.

## Root Causes Found and Fixed

### 1. robots.txt fetched over the wrong scheme/port
**File:** `src/browser/crawler/robots-cache.ts`
**Problem:** Hardcoded `https://${domain}/robots.txt`. Against the http-only local test server used to verify the scheduler, the robots.txt fetch silently failed (wrong scheme) and fell back to allow-all, so a `Disallow`-marked path was fetched anyway. robots.txt is scoped per-**origin** (scheme+host+port), not per-hostname.
**Fix:** `RobotsCache.getRules/canFetch/crawlDelayMs` now take a full origin (`https://a.com`, `http://127.0.0.1:8080`) instead of a bare hostname; `crawler-scheduler.ts` computes `new URL(url).origin` and passes that, while frontier/politeness grouping still keys on hostname alone (grouping by physical host is the more conservative choice there).

### 2. Node, not Electron ABI, was the wrong target for the main-process build
**Problem:** `electron/*.cjs` has zero TypeScript build step feeding it (confirmed: `npm run build` isn't wired into `electron:dev` or the packaged-app scripts, and the project's `tsconfig.json` `moduleResolution: "bundler"` wouldn't emit Node-runnable ESM regardless).
**Fix:** New `tsconfig.main.json` (CommonJS, `moduleResolution: "node"`, scoped to `src/browser/crawler/**`, output to `dist-main/`) + `npm run build:crawler`, wired into `electron:dev`/`electron:start`/`build:win`/`build:mac`/`build:linux`/`pack:win`.

### 3. Node silently produced empty `exports` from the compiled CommonJS output
**Problem:** Root `package.json` has `"type": "module"`, so Node treated `dist-main/**/*.js` (CommonJS syntax) as ES modules — `require()` succeeded but returned an empty module (Node's require(esm) interop), with no error.
**Fix:** `scripts/ensure-dist-main-pkg.cjs` writes `dist-main/package.json` (`{"type":"commonjs"}`) as part of `build:crawler`, overriding the root's ESM default for that subtree.

## What Was Built

- **`link-extractor.ts`** — `extractLinks(anchors, baseUrl)`: resolves `<a href>` against the base URL, strips fragments, skips `javascript:`/`mailto:`/`tel:`/fragment-only links, collects anchor text from nested markup.
- **`crawler-scheduler.ts`** — `CrawlerScheduler`: pulls the next eligible frontier URL (respecting per-domain in-flight exclusion), checks robots.txt, fetches, parses via the existing `HtmlParser.parse → DomTree.buildFromHtml → extractIndexableDocument` chain (reused unchanged), content-hash dedup, discovers links (recorded in the link graph always; enqueued only when their domain is in the curated allow-list), applies politeness delay (`robots.txt` crawl-delay or a configurable floor).
- **`tsconfig.main.json` + `scripts/ensure-dist-main-pkg.cjs` + `npm run build:crawler`** — the main-process build pipeline described above.
- **`electron/crawler-service.cjs`** — `initNovaCrawlerService()`/`disposeNovaCrawlerService()`, following the `socket-owner.cjs` convention; `ipcMain.handle('nova:crawler', ...)` with actions `addSeed`/`start`/`stop`/`stats`/`search`; lazily dynamic-`import()`s the compiled `dist-main` modules. Wired into `main.cjs`'s `whenReady`/`before-quit`.
- **`electron/preload.cjs`** — new `window.nova.crawler.request(payload)` bridge (mirrors the existing `nova:net` bridge pattern).
- **`crawler-client.ts`** — renderer-side typed wrapper over the bridge (`addSeed`, `startCrawl`, `stopCrawl`, `getStats`, `searchWebIndex`, `isCrawlerAvailable`).
- **`web-index-port.ts`** — `WebIndexPort`: adapts the async IPC search into the synchronous `ArchivePort`-shaped interface `SearchPage` needs — `search(query)` returns the last-cached results immediately and kicks off a background refresh, firing `onChange` (the same mechanism `PersonalSearchArchive` already uses) when results arrive. Also parses FTS5's `<mark>`-wrapped snippet into plain text + numeric highlight ranges rather than ever passing raw HTML to the renderer (crawled third-party text must never be set via `innerHTML` unescaped).
- **`search-page.ts`** — new `webIndexSection()` ("From the web (crawled)"), labeled distinctly from the personal archive ("Crawled" vs "Visited"); `SearchPageDeps.webIndex` is optional (omitted → section doesn't render).
- **`search-integration.ts`** — one `WebIndexPort` instance per window (cache survives navigation), passed to `SearchPage` only when `isCrawlerAvailable()`.
- **`settings-page.ts`** — new "Web Index" section: page-cap/concurrency range settings, a seed-site add box, start/stop crawl buttons, and a one-shot (not polling — avoids leaking timers across re-renders) stats readout; shows an explanatory message outside the Electron app where the bridge doesn't exist.

## Deliberately deferred (per the plan's Phase 6)
PageRank / link-graph ranking boost, SimHash/MinHash near-dup detection beyond content-hash, adaptive re-crawl scheduling, JS-rendered seed pages, cross-domain link following beyond the curated allow-list.

## Files Created
| File | Purpose |
|------|---------|
| `src/browser/crawler/link-extractor.ts` | `<a href>` + anchor text extraction. |
| `src/browser/crawler/crawler-scheduler.ts` | Fetch → extract → index → link-discovery orchestration. |
| `src/browser/crawler/crawler-client.ts` | Renderer-side `nova:crawler` IPC client. |
| `src/browser/crawler/web-index-port.ts` | Async-to-sync `ArchivePort`-shaped adapter for `SearchPage`. |
| `electron/crawler-service.cjs` | Main-process crawler lifecycle + IPC handler. |
| `tsconfig.main.json` | Main-process (CommonJS) build config, scoped to `src/browser/crawler/`. |
| `scripts/ensure-dist-main-pkg.cjs` | Writes `dist-main/package.json` so Node treats the output as CommonJS. |
| `tests/crawler-link-extractor.test.ts` | 7 tests. |
| `tests/crawler-scheduler.test.ts` | 5 tests (real local HTTP server, real robots.txt, real links). |
| `tests/crawler-web-index-port.test.ts` | 6 tests. |

## Files Modified
| File | Change |
|------|--------|
| `src/browser/crawler/crawler-db.ts` | `search()` now joins `documents` for `fetchedAt`; dedup-null-check fix carried from Phase 1 doc. |
| `src/browser/crawler/robots-cache.ts` | Origin-based (not hostname-based) robots.txt fetching — root cause #1 above. |
| `electron/main.cjs` | Wires `initNovaCrawlerService`/`disposeNovaCrawlerService` into `whenReady`/`before-quit`. |
| `electron/preload.cjs` | Adds the `nova.crawler` bridge. |
| `src/ui/pages/search-page.ts` | `webIndexSection()`, optional `webIndex` dep, `hit()` takes a `label` param ("Visited" vs "Crawled"). |
| `src/ui/pages/search-integration.ts` | Instantiates and wires `WebIndexPort`. |
| `src/ui/pages/settings-page.ts` | New "Web Index" settings section. |
| `package.json` | `build:crawler` script; `electron:dev`/`electron:start`/`build:win`/`build:mac`/`build:linux`/`pack:win` now run it first. |
| `electron-builder.yml` | `dist-main/**` added to packaged `files`; flagged open risk (see below). |
| `.gitignore` | `dist-main/` added. |
| `tests/crawler-db.test.ts`, `tests/crawler-robots-cache.test.ts` | Updated for the `fetchedAt` field and origin-based robots API. |
| `tests/search-page.test.ts`, `tests/settings-page.test.ts` | New describe blocks for the web-index section. |

## Known open risk (not yet resolved, flagged for whoever ships this)
`node-sqlite3-wasm` is a runtime dependency of the compiled crawler code, but `electron-builder.yml`'s `files` excludes all of `node_modules/**`. Whether electron-builder's own production-dependency walk re-includes it regardless of that glob is **not verified** — needs an actual packaged-build smoke test (`npm run build:win` or equivalent, then run the installed app) before this feature ships to end users. Comment left in `electron-builder.yml` at the relevant line.

## Test Results
```
npx tsc --noEmit                      → 0 errors
npx vitest run (crawler-only files)   → 12 files, 64 tests, all passing
npx vitest run (full suite, Phase 1)  → 268 files / 10,432 tests, all passing (run before Phase 2-5 changes)
npx vitest run (full suite, Phase 2-5)→ see below (background run)
node scratch-smoke-test.cjs            → end-to-end run of the COMPILED dist-main pipeline against a real local
                                          HTTP server with linked pages + a robots.txt Disallow rule: seed crawled,
                                          linked same-domain page crawled and indexed, disallowed page never
                                          fetched, FTS5 search found the right page by content. PASSED.
```

## Verification Steps Taken
- Every new backend module (db, robots parser/cache, fetcher, link extractor, scheduler) has real-behavior unit tests — real SQLite, a real local loopback HTTP server (gzip, redirects, timeouts, 404s, robots.txt, linked pages) — not mocks of the thing under test.
- Verified the actual compiled `dist-main/**/*.js` output (not just the `.ts` source) loads and runs correctly via plain `require()`/dynamic `import()`, matching exactly how `electron/crawler-service.cjs` consumes it.
- Launched the real Electron app (`npm run electron:start`) and confirmed via the health log that `initNovaCrawlerService()` runs without throwing during startup (all stray launched Electron processes were cleaned up afterward).
- `nova:crawler` IPC bridge and `WebIndexPort`'s cache/refresh/onChange logic are unit-tested in isolation (mocked IPC) since they can't be exercised without a live Electron window.
