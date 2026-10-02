# DevTools Network Tab — Real Resource Load Log

**Date:** 2026-09-12
**Session:** Continue improving the browser after the Console and Elements tabs — add a "Network" tab showing real resource loads. Also investigated (and deliberately deferred) multi-tab crash isolation.
**Status:** Completed

---

## Summary
Added a third tab to the DevTools panel (Console, Elements, now Network) that logs every resource `ResourceLoader` loads for the current page — the main document itself, scripts, images, stylesheets — with status, kind, URL, cache/duration, and error text when a load fails. Instrumented at the single real choke point every resource load already passes through (`ResourceLoader.loadResource()`), which — via `PageLoader` calling it with `kind: 'document'` for the top-level navigation — covers the main page load too, with no extra wiring needed.

## Root Cause
Same shape of gap as the two prior DevTools tabs this session: `ResourceLoader` had no way for anything outside itself to observe a completed load. Unlike the Console (`console-api.ts` already had a listener API built in) and Elements (`getDomTree()` just had no passthrough), this one needed a new instrumentation point added to `ResourceLoader` itself, since nothing like it existed yet.

## Notes
- **Instrumentation approach:** `loadResource()`'s original ~290-line body (with several early-return error paths — cache hit, blocked, CORS preflight failure, CORS violation, CORP violation, network error) was renamed to a private `loadResourceCore()` unchanged, and a new thin public `loadResource()` wraps it: call `loadResourceCore()`, notify `onLoad` with the result, return it. This is a mechanical, low-risk wrap — no control-flow inside the original method touched — chosen specifically to avoid threading a callback through every one of those return sites individually.
- Because `loadStylesheet()`/`loadScript()`/`loadImage()`/`loadBatch()` all call `this.loadResource(...)` (the public method) rather than duplicating logic, they're automatically instrumented too — no separate wiring needed per resource type.
- `setOnLoad()` follows the same setter pattern already used by this class for `setCache()`/`setCors()`, rather than a constructor parameter, to avoid touching the constructor signature other call sites depend on.
- **Investigated and deliberately did not build:** multi-tab crash isolation (the next item on the outstanding list). Traced the real current architecture and found the question is currently moot — `BrowserEngine` has exactly one shared `PageRenderer`/`DomTree`/`JsEventLoop` for the whole app; switching tabs fully re-navigates that one pipeline rather than swapping between independent live per-tab state, and per-script errors are already caught inside `runJS()` and never escape to affect anything else. The real gap uncovered is different from what the isolation scoping doc guessed: `TabContext`'s own `domTree`/`layoutEngine`/`paintEngine`/`eventLoop` fields are instantiated per tab but never read by `PageRenderer` — actually giving tabs independent live state (so a background tab keeps running, keeps scroll position, etc.) would be a real, valuable feature, but it's a materially bigger architectural change than any of this session's DevTools work and wasn't attempted here.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/networking/resource-loader.ts` | Renamed `loadResource()`'s body to private `loadResourceCore()`; added a thin public `loadResource()` wrapper that notifies `onLoad`; added `setOnLoad()` to the class and `IResourceLoader` interface |
| `src/browser/engine/browser-engine.ts` | Added `networkEntry` engine event + `notifyNetworkEntry()` |
| `src/app/main.ts` | Wired `resourceLoader.setOnLoad((entry) => engine.notifyNetworkEntry(entry))` |
| `src/ui/components/devtools-panel/devtools-panel.ts` | Added a Network tab and `addNetworkEntry()` renderer |
| `src/ui/pages/browser-window.ts` | Subscribes to the engine's `networkEntry` event and feeds the panel |
| `tests/page-loader.test.ts`, `tests/page-renderer.test.ts` | Added `setOnLoad: vi.fn()` to the mock `IResourceLoader` objects (interface grew a new required method) |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-09-12-devtools-network-tab.md` | This document |

## Test Results
```
npx tsc --noEmit -p .                                            → 0 errors (repo-wide)
npx vitest run                                                    → 222 files / 9216 tests passed
npx playwright test --config=playwright-electron.config.cjs       → 4/4 passed
  (electron-smoke, fidelity-audit, keep-alive, plus a scratch
   Network-tab fixture used to verify this feature, since deleted)
```

## Verification Steps
1. Built a fixture page with a real document load and one deliberately-broken `<img src="...missing.png">`.
2. Opened DevTools (`Ctrl+Shift+J`), clicked the Network tab, and confirmed via `innerText` that both the document row (`200`, `document`, real URL, real duration) and the failed image row (`ERR`, `image`, the missing URL, "Failed to fetch") appear, correctly color-coded.
3. Confirmed via screenshot that the broken image's placeholder renders on the page itself, consistent with the Network tab correctly reporting that exact failure.
