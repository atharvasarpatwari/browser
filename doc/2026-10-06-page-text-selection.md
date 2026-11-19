# Text Selection on Rendered Pages — and Searching It

**Date:** 2026-10-06
**Session:** Second of two follow-ups (fix painted text → text selection)
**Status:** Completed — verified in the real Electron app

---

## Summary

Rendered pages are a bitmap, so they had no text selection. You can now select page text and use it:

| Gesture | Result |
|---|---|
| drag | selects text, highlighted over the page (follows the pointer even outside the page) |
| double-click / triple-click | a word / the whole block (paragraph, cell…) |
| Shift-click | extends the selection |
| Ctrl+A / Ctrl+C | selects the page's text / copies the selection to the OS clipboard (not while typing in the address bar or find box) |
| click elsewhere, navigate, switch tab | ends the selection |
| right-click on the selection | menu leads with **Copy · Search <engine> for “…” · Ask Nova AI about “…”** (search opens a new tab); right-click elsewhere ends the selection first |

Built-in `nova://` pages (real DOM) and the Android layout are untouched. A drag that ends over a link no longer also follows the link.

## Design

- **`PageSelection`** (`src/browser/navigation-controls/page-selection.ts`): a selection is two offsets into the page's searchable text — the very corpus find-in-page searches (`buildCorpus`, now exported with `rectOf`/`runWidth`) — so it needs no DOM nodes and survives a repaint. `caretAt(x, y)` picks the line first (nearest baseline band), then the character from the run's width; `rects()` gives one rectangle per touched run.
- **`PageSelectionController`** (`src/ui/components/page-selection/page-selection-controller.ts`): mouse gestures on the page canvas, a pointer-transparent overlay canvas (z-index 4, below find's highlights), the page↔client mapping reused from find (`computeViewTransform`, `mapRect`).
- **Wiring:** `SearchIntegration.enableSelection()` (desktop layout only), `selectionAt()` for the menu, Ctrl+A/Ctrl+C in its key handler, clear on leaving a page, redraw on repaint. `buildPageContextMenu` gets the selection group; a selection no longer replaces the Back/Forward/Reload items.
- Run widths: `find-page-source` now uses the width layout recorded on each run (added in the previous change) instead of the distance to the next run, so highlight rectangles match the painted glyphs.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/navigation-controls/find-in-page.ts` | exports `buildCorpus`, `rectOf`, `runWidth`, `Segment` |
| `src/browser/navigation-controls/find-page-source.ts` | exact run widths |
| `src/ui/pages/search-integration.ts` | selection lifecycle, Ctrl+A / Ctrl+C, `selectionAt` |
| `src/ui/components/context-menu/page-context-menu.ts` | selection group, `selectionAt` dependency |
| `src/ui/pages/browser-window.ts` | enables selection, passes `selectionAt` (desktop only) |
| `tests/page-context-menu.test.ts` | +5 |
| `tests/e2e/helpers/electron-app.ts`, `tests/e2e/search-electron.spec.ts` | `/select` page; +1 end-to-end test |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/navigation-controls/page-selection.ts` | the selection model |
| `src/ui/components/page-selection/page-selection-controller.ts` | gestures + overlay |
| `tests/page-selection.test.ts` | 10 |
| `tests/page-selection-controller.test.ts` | 13 (two mutation-checked: swallowing the click after a drag, blurring a text field) |
| `doc/2026-10-06-page-text-selection.md` | this change log |

## Test Results

```
$ npx tsc --noEmit                         → 0 errors
$ npx vitest run                           → 259 files; 10,337 of 10,340 pass (the 3 known DnsResolver environmental timeouts)
$ npm run build:web; npx playwright test … search-electron, electron-smoke, keep-alive
  12 passed (1.2m) incl. "text on a rendered page can be selected, copied, and searched from the right-click menu"
```

## Verification

Real Electron on a local page: double-click selects `Alpha` and Ctrl+C puts exactly that on the OS clipboard; a drag from the line start past its end copies the whole line; right-click on it shows Copy / Search / Ask, and Search opens a second tab at `nova://search?q=Alpha%20bravo…`; Ctrl+A highlights the page; a click elsewhere clears it. (First attempts failed on my own test coordinates — a drag that started inside the first letter, and a right-click aimed below the line, which correctly ended the selection.)

## Not done / limits

- Selection order is DOM order, not visual order: floats, columns and flex `order` can make a drag select oddly (same limit as find).
- No auto-scroll while dragging past the page edge (scrolling is baked into the bitmap); no `user-select: none` handling; hidden text is not filtered; selection is not mirrored to `window.getSelection()`.
- Ctrl+F scroll-to-match still needs an engine scrolling API.
- Clicking a word on a page does not move a caret (pages have no editable text).
