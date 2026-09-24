# Real Find-in-Page — Ctrl+F Searches the Actual Page, Not Lorem Ipsum

**Date:** 2026-09-12
**Session:** `FindInPage.getSampleText()` was flagged earlier today (during the toolbar/menu work) as still returning a hardcoded Lorem Ipsum paragraph instead of real page content — the code's own comment said so. Built the real version now.
**Status:** Completed

---

## Summary
`FindInPage`'s search state machine (matches, next/previous with wraparound, clear, events) was real and well-tested, but the actual *content* it searched was a hardcoded Lorem Ipsum string baked into the class — `find('anything on a real page')` could never find it, because no real page text was ever fed in. Ctrl+F previously did not exist as a browser feature at all — there was no find bar, no highlight, nothing reachable by a user. Built all three: a real DOM-text search, a find bar UI, and on-page match highlighting.

## What Was Built
- `FindInPage.findInDom(domTree, query, options)` — a new method (additive; the original `find()` and its Lorem Ipsum fallback are untouched, so the existing unit tests that exercise the search/next/previous/clear state machine against that fixed corpus keep passing) that walks the real, live DOM tree the same way the DevTools Elements tab does, matching the query against each text node's real content and recording which element contains each match.
- `FindBar` (`src/ui/components/find-bar/find-bar.ts`) — a real floating find bar: text input, live match count, Previous/Next, Close. Enter/Shift+Enter step through matches; Escape closes.
- `ContentRenderer.getBufferToViewportScale()` — converts a layout box in the engine's own buffer-pixel space into on-screen viewport pixels, already zoom-aware (reads the canvas's *post-transform* bounding rect, so it's correct whether or not the page is zoomed).
- A highlight overlay (`browser-window.ts`) positioned from the current match's containing element's real `LayoutBox` (via the already-exposed `getPageLayoutEngine().getLayoutBox()`), converted to screen coordinates and drawn as a semi-transparent rectangle over the actual rendered content.
- Ctrl+F opens the find bar, positioned at the content area's top-right corner.

## Notes
- Highlighting is at the *containing element's* granularity (the whole paragraph/box that has a match), not a tight rectangle around just the matched substring — Nova's `LayoutBox` model tracks per-element boxes, not per-substring text-run rects. This is an honest, useful approximation (it clearly shows *where* the match is) rather than a fake pixel-perfect claim; a tighter highlight would need per-text-run position tracking through the paint pipeline, a larger change.
- No live re-search on DOM mutation — if the page's content changes after a search, the find bar doesn't automatically re-run. A real, but small and expected gap for a first version.
- Matches only search text within the current DOM snapshot at the moment Ctrl+F's query changes; case-insensitive by default (matching the existing `find()` API's `FindOptions`).

## Files Modified
| File | Change |
|------|--------|
| `src/browser/navigation-controls/find-in-page.ts` | Added `findInDom()` + `searchDomText()`, and an optional `elementDomId` field on `FindMatch` |
| `src/ui/components/content-renderer/content-renderer.ts` | Added `getBufferToViewportScale()` |
| `src/ui/pages/browser-window.ts` | Instantiates `FindInPage`/`FindBar`; wires Ctrl+F, query/next/previous/close, and the highlight overlay |

## Files Created
| File | Purpose |
|------|---------|
| `src/ui/components/find-bar/find-bar.ts` | The find bar UI component |
| `doc/2026-09-12-find-in-page.md` | This document |

## Test Results
```
npx tsc --noEmit -p .                                            → 0 errors (repo-wide)
npx vitest run                                                    → 222 files / 9216 tests passed (including the
                                                                     original FindInPage unit tests, unmodified)
npx playwright test --config=playwright-electron.config.cjs       → 4/4 passed
  (electron-smoke, fidelity-audit, keep-alive, plus a scratch
   find-in-page fixture used to verify this feature, since deleted)
```

## Verification Steps
1. Built a fixture with the word "fox" appearing exactly twice across three paragraphs.
2. Pressed Ctrl+F, typed "fox", and confirmed the live match count read "1/2" as soon as two characters narrowed it correctly (verified the count updates per-keystroke: "f" → 3 matches including an unrelated word, "fo"/"fox" → correctly narrows to 2).
3. Confirmed a real yellow highlight box appeared over the first matching paragraph, with sensible on-screen dimensions matching that paragraph's real rendered size.
4. Pressed Enter and confirmed the match count advanced to "2/2" and the highlight moved to the second paragraph.
