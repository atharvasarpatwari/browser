# DevTools Console Panel — Wiring Real Page Output Into a Visible Panel

**Date:** 2026-09-12
**Session:** Continue improving the browser ("don't stop, improve it") after the click-dispatch fix — build a real, working DevTools Console panel.
**Status:** Completed

---

## Summary
`src/browser/js/console-api.ts` (written earlier this session as part of the click-dispatch investigation) already gave `window.console` a real, externally-readable log with a listener API — its own comment said this was "the root reason a DevTools Console panel could never exist." Investigating what consumed that API found a second, larger piece of orphaned infrastructure: a fully built, 99-test `DevTools`/`ConsoleService`/`NetworkMonitor`/`DOMInspector` model (`src/browser/networking/devtools.ts`, `src/browser/devtools/devtools-facade.ts`) that was never instantiated anywhere in the running app, and a dedicated `devtools` layout region in `DesktopLayout` (`areas.devtools`, `toggleDevtools()`, a `devtoolsToggled` event) that was never populated or toggled by anything. This session wired a real, minimal Console panel through the actually-live path (page console → `PageRenderer` → `BrowserEngine` event → UI), rather than adopting the larger orphaned `devtools.ts` model, and hooked it into the pre-built (but unused) `DesktopLayout` devtools region.

## Root Causes
1. **No consumer existed for `console-api.ts`'s `onConsoleMessage`/`getConsoleLog`.** They were exported from `js/index.ts` but never called from anywhere else in the codebase — a page's console output had a real structured sink but nothing outside the JS engine ever read from it.
2. **`DesktopLayout`'s `devtools` area/`toggleDevtools()`/`devtoolsToggled` event were fully built but never used.** No code anywhere called `toggleDevtools()`, read `areas.devtools`, or listened for `devtoolsToggled` — a ready-made docked-panel layout slot sat empty.
3. **First panel attachment point chosen (`areas.content`) was wrong** — `ContentRenderer.renderFromImageData()` does `this.container.innerHTML = ''` on every fresh-canvas render (e.g. every navigation), which would silently destroy any sibling element attached inside the same container, including a first draft of this panel. Re-targeted at the dedicated `areas.devtools` region instead, which `ContentRenderer` never touches.
4. **F12 was the first shortcut tried and collided with Electron's own DevTools.** `DesktopLayout`'s default `viewMenu` role binds F12 (and `Ctrl+Shift+I`, separately blocked in production via `before-input-event`) to the *host* Chromium DevTools before the event ever reaches the page-level `keydown` listener. Re-bound to `Ctrl+Shift+J`, which nothing else in the app claims.

## Notes
- Kept the new panel deliberately separate from `devtools.ts`'s `ConsoleService`/`DevTools` facade — that model adds grouping, filtering, a Network monitor and a DOM inspector, none of which have a live data source wired up yet either. Building a new panel directly off `console-api.ts`'s already-real `ConsoleEntry` shape is a smaller, immediately-correct slice; the bigger facade is still there if a future session wants Network/DOM panels too, in which case it may be worth switching the Console panel over to route through `ConsoleService` for consistency.
- The panel's own render logic (`DevToolsPanel` in the new `devtools-panel.ts`) has no show/hide state of its own — visibility is entirely owned by `DesktopLayout.toggleDevtools()`, which the panel's container already had wired in for exactly this purpose. This avoids a second source of truth for "is devtools open."
- `MobileLayout` has no `devtools` area — the panel is desktop-only, matching how real mobile browsers don't expose a docked devtools console either.
- Each navigation creates a fresh `console` object (`createGlobalEnv`'s `env.setLocal('console', createConsoleObject())`), so the old page's `onConsoleMessage` listener naturally becomes unreachable once its `consoleObj` is replaced — no explicit unsubscribe/cleanup needed on navigation.
- Also fixed a pre-existing, now-twice-recurred test flake surfaced while re-running the full suite: `tests/bytecode-vm.test.ts`'s `fib(20)` timing budget (2000ms) failed under full-suite contention a second time (passes in ~280ms in isolation every time) — per the criterion `doc/known-test-failures.md` already recorded for this exact test ("if it recurs... loosen the budget"), bumped to 2500ms. Unrelated to the console panel work; a pure scheduling flake under load.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/engine/page-renderer.ts` | `executeAllScripts()` subscribes to the page's `console` object via `onConsoleMessage()` and forwards each entry to `deps.onConsoleMessage` |
| `src/browser/engine/browser-engine.ts` | Added `consoleMessage` engine event + `notifyConsoleMessage()` |
| `src/app/main.ts` | Wired `onConsoleMessage: (entry) => engine.notifyConsoleMessage(entry)` into the `PageRenderer` deps |
| `src/ui/pages/browser-window.ts` | Instantiates `DevToolsPanel` into `areas.devtools`; subscribes to the engine's `consoleMessage` event; `Ctrl+Shift+J` toggles `DesktopLayout.toggleDevtools()` |
| `tests/bytecode-vm.test.ts` | Loosened the `fib(20)` timing budget 2000ms → 2500ms (recurring scheduling flake, see Notes) |
| `doc/known-test-failures.md` | Recorded the second occurrence and the budget change |

## Files Created
| File | Purpose |
|------|---------|
| `src/ui/components/devtools-panel/devtools-panel.ts` | Renders live `ConsoleEntry` rows (level-colored, timestamped) into a container; a Clear button; no visibility state of its own |
| `doc/2026-09-12-devtools-console-panel.md` | This document |

## Test Results
```
npx tsc --noEmit -p .                                            → 0 errors (repo-wide)
npx vitest run                                                    → 222 files / 9216 tests passed
npx playwright test --config=playwright-electron.config.cjs       → 4/4 passed
  (electron-smoke, fidelity-audit, keep-alive, plus a scratch
   console-fixture used to verify this feature, since deleted)
```

## Verification Steps
1. Built a fixture page with `console.log`/`console.warn`/`console.error` calls (including an object argument, to check formatting).
2. Loaded it in the real Electron app via Playwright, pressed `Ctrl+Shift+J`, and confirmed via `getComputedStyle` that `.devtools` flips from `display:none` to `display:flex`.
3. Confirmed the panel's rendered text matches the real page's console calls exactly, level-colored and timestamped, via a real screenshot.
4. Pressed `Ctrl+Shift+J` again and confirmed the panel closes (`display:none`), proving the toggle round-trips correctly.
5. Diagnosed and fixed two wiring bugs found along the way (documented above): the innerHTML-wipe conflict from attaching to `areas.content`, and the F12/host-DevTools shortcut collision — both root-caused with the same before/after DOM-state instrumentation technique used earlier in the click-dispatch session, then the instrumentation was removed.
