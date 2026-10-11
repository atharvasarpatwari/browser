# DevTools Elements Tab — Live DOM Tree View

**Date:** 2026-09-12
**Session:** Continue improving the browser after the Console panel — add a second, "Elements" tab showing the real live DOM tree.
**Status:** Completed

---

## Summary
Extended the `DevToolsPanel` shipped earlier this session (previously Console-only) with a second tab that snapshots and renders the currently-loaded page's real DOM tree — tag names, attributes, and non-empty text nodes, indented by depth. Reuses the same `Ctrl+Shift+J` toggle and the same `DesktopLayout.devtools` region; switching tabs and refreshing are both handled inside the one panel component.

## Root Cause
`PageRenderer` already had a working `getDomTree(): IDomTree` method, but it wasn't declared on the `IPageRenderer` interface and had no `IBrowserEngine` passthrough — so nothing above the engine layer could ever reach the live DOM tree. Same shape of gap as `getPageLayoutEngine()`/`dispatchPointerEvent()` earlier this session: a real capability one layer down with no path up to the UI.

## Notes
- Discovered a genuine, previously-invisible parser bug while building this: every parsed element's `attributes` map carried a phantom empty-key/empty-value entry (confirmed via real e2e output — a plain `<div id="x">` displayed as `<div id="x" ="">`). Root-caused as likely originating in the HTML tokenizer/tree-builder (not `dom-tree.ts`, which just copies `HtmlElement.attributes` verbatim). Worked around defensively in the Elements tab's own rendering (filter out empty-string keys) since fixing the tokenizer itself is a separate, unrelated investigation — flagged as its own background task (`task_3d50acd0`) rather than scope-creeping into it here.
- Deliberately a manual-refresh snapshot, not a live/auto-updating tree (real DevTools re-renders on every mutation via a MutationObserver-equivalent) — a `Refresh` button re-walks the tree on demand, and switching to the tab also refreshes it once. Auto-live updates would need hooking into the same `domTree` mutation-recording path already used by the reflow controller; not done here to keep this addition the same size as the Console panel.
- Capped at 2000 rendered nodes (`MAX_TREE_NODES`) to avoid choking the panel on a very large page — mirrors the existing `MAX_ROWS` cap on the Console tab.
- No click-to-highlight-on-canvas or computed-style inspection (the bigger, pre-existing `DOMInspector` in `src/browser/networking/devtools.ts` has hooks for both `StyleProvider`/`BoxModelProvider`, but adopting that class wholesale is a larger, separate step — noted in the Console panel's own changelog doc from earlier today).

## Files Modified
| File | Change |
|------|--------|
| `src/browser/engine/browser-engine.ts` | Added `getDomTree()` to `IPageRenderer`/`NullPageRenderer` and `getPageDomTree()` to `IBrowserEngine`/`BrowserEngine`, mirroring the existing `getPageLayoutEngine()` passthrough |
| `src/ui/components/devtools-panel/devtools-panel.ts` | Added a Console/Elements tab strip, a DOM-tree renderer, and a `setDomTreeProvider()` hook |
| `src/ui/pages/browser-window.ts` | Wires `devToolsPanel.setDomTreeProvider(() => browserEngine.getPageDomTree())` |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-09-12-devtools-elements-tab.md` | This document |

## Test Results
```
npx tsc --noEmit -p .                                            → 0 errors (repo-wide)
npx vitest run                                                    → 222 files / 9216 tests passed
npx playwright test --config=playwright-electron.config.cjs       → 4/4 passed
  (electron-smoke, fidelity-audit, keep-alive, plus a scratch
   Console+Elements fixture used to verify this feature, since deleted)
```

## Verification Steps
1. Built a fixture page with a uniquely-named element (`#marker-unique-el-123`) nested a few levels deep.
2. Opened DevTools (`Ctrl+Shift+J`), clicked the Elements tab, and confirmed via `innerText` that the rendered tree contains the real tag structure and that marker id, correctly indented.
3. Confirmed the phantom-attribute artifact (see Notes) before the defensive filter, and that it's gone after.
4. Switched back to the Console tab and confirmed both tab buttons plus Refresh/Clear are present and clickable without error, proving the two tabs coexist in one panel without interfering with each other.
