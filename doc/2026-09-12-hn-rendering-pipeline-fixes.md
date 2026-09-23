# HN Rendering Pipeline — 11 Root-Cause Fixes (Tree-Builder, Layout, Tokenizer)

**Date:** 2026-09-12
**Session:** Continuation of a multi-session investigation into why real-world pages (news.ycombinator.com used as the reference case) rendered as a blank page, then as garbled/overlapping text, on branch `claude/ponytail-folder-browser-8b310d`.
**Status:** Completed

---

## Summary
Starting from a blank-page render of Hacker News, this arc found and fixed 11 distinct root-cause bugs spanning the HTML5 tokenizer, the HTML5 tree-builder, CSS value resolution, table layout, inline layout, and the paint engine — each one uncovered only after the previous fix let the page get further before failing visually. The page went from **entirely blank**, to **a wall of phantom vertical border lines**, to **giant blank gaps swallowing the story list**, to **rows overlapping each other**, to **titles overlapping their own wrapped second line**, to, finally, **fully correct, readable rendering** verified pixel-by-pixel via raw canvas `getImageData()` inspection. A final, separately-discovered pass fixed two character-reference bugs in the tokenizer (entities leaking out of attribute values as stray text, e.g. a literal `&&` before every story title; numeric character references corrupting the character immediately after them, e.g. `I&#x27;ve` rendering as `I' ve`).

## Root Causes
1. **`90a3b29`** — `border-style: none` (the default) was still painted, because paint-engine only checked `width > 0`, not style; every element on every page got a phantom "medium" border.
2. **`c0dc96f`** — Three compounding inline-layout bugs: inline elements sized like blocks instead of shrink-to-fit; nested inline children laid out at the IFC's outer origin instead of their own position; the first line box double-counted `startY`.
3. **`cf37d10`** — `resolveComputedValue()`'s line-height special case used `parseFloat()` on any unrecognized unit, silently turning `12pt` into a `x12` multiplier (~12x inflation); `pt` was also missing from `resolveLength`/`resolveFontSize`/`resolveLineHeight`.
4. **`95c9990`** — Table row-height advanced by a pre-layout guess (CSS height or a hardcoded 20px) instead of the real height cells computed once laid out, so tall/wrapped cell content overflowed into the next row.
5. **`420c94e`** — `<table>`/`<tr>`/`<td>` etc. never got their implicit `display: table*` UA defaults, so table layout was dead code for virtually every real table; a second bug then collapsed all table-role displays into one type, causing `layoutTableContainer` to recurse into itself on table cells; a third (found chasing the second) was the tree-builder's mode-delegation helpers permanently overwriting `insertionMode` instead of restoring it, breaking nested tables.
6. **`7ddb76d`** — `resetInsertionMode()` had no cases for a `td`/`th`/`tr` current node (spec §13.2.4.1), so their end tags parse-errored and were dropped; also missing the "clear the stack back to a table body context" step, so an unclosed `<tr/>` absorbed its own next sibling.
7. **`6c46484`** — `inBodyEndTag`'s switch had no default case implementing HTML5's generic "any other end tag" algorithm (§13.2.6.7); `<span>` and ~40 other ordinary elements never closed at all.
8. **`917d806`** — `layoutAnonymousBlock` never passed `startX` to its `InlineFormattingContext`, mispositioning inline content horizontally; `isTextOnlyInlineSubtree` only checked direct children (not recursively), causing spurious wide-width fallbacks for nested inline elements; table column widths used naive equal distribution instead of content-based min/max measurement.
9. **`4b03e13`** — The definitive fix for the last remaining overlap: `ifc.addBox()` recorded a box's height into the line's height *before* the box's own recursive child-layout could grow `box.height` from internal wrapping, so a title cell that wrapped to two lines under-reported its row height, and the next row painted directly on top of the wrapped second line. Proven via raw `getImageData()` pixel inspection showing two unrelated rows' text at the identical Y-coordinate.
10. **`915da03`** — Layout/paint engines always rendered at a hardcoded 1920×1080 viewport regardless of real window size, forcing the canvas to rescale and blur this rasterizer's sharp bitmap font on any other window size.
11. **`b3dbc32`** — Two tokenizer bugs: decoded character references were always appended to the general text buffer even when consumed inside an attribute value (leaking e.g. `&amp;` from an `href` as stray `&&` text after the element); numeric character references terminated by `;` never transitioned the tokenizer back to its caller's state, so the next character was silently eaten or replaced with U+FFFD (e.g. `I&#x27;ve` → `I' ve`).

## Notes
- Each fix was verified against a live/saved copy of news.ycombinator.com, not just unit tests — several of these bugs (rows overlapping, title/subtext overlap) were only conclusively provable via raw canvas pixel (`ctx.getImageData()`) inspection rendered as ASCII, since screenshots alone couldn't rule out rendering artifacts.
- `tests` count (3) is a net delta derived from `git diff` on the two touched test files (`tests/image-decoder.test.ts` +2, `tests/formatting-contexts.test.ts` +1 net after accounting for one reformatted existing signature in each); `tests/page-renderer.test.ts`'s change was an assertion-only fix, not a new test.
- One commit in this arc, `a89920a` (`feat(image): decode GIF via native createImageBitmap`), is a capability addition rather than a bug fix and is not counted in the 11 root causes above, but is included in the files/tests totals since it's part of the same continuous session.
- All scratch/debug test files and screenshots created during investigation (e.g. `tests/_scratch-*.test.ts`, `tests/e2e/hn-*.spec.ts`, `_hn-snapshot.html`) were deleted before each commit; `git status` was clean before every commit in this arc.

## Files Modified
| File | Commits |
|------|---------|
| `src/browser/image/decoder.ts` | a89920a |
| `src/browser/rendering/paint-engine.ts` | 90a3b29 |
| `src/browser/rendering/formatting/inline-context.ts` | c0dc96f |
| `src/browser/rendering/layout-engine.ts` | c0dc96f, cf37d10, 95c9990, 917d806, 4b03e13 |
| `src/browser/rendering/css5/computed-value-resolver.ts` | cf37d10 |
| `src/browser/rendering/formatting/table-context.ts` | 95c9990, 917d806 |
| `src/browser/rendering/css5/cascade.ts` | 420c94e |
| `src/browser/rendering/formatting/types.ts` | 420c94e |
| `src/browser/rendering/html5/tree-builder.ts` | 420c94e, 7ddb76d |
| `src/browser/rendering/html5/modes/table.ts` | 7ddb76d |
| `src/browser/rendering/html5/modes/types.ts` | 7ddb76d |
| `src/browser/rendering/html5/modes/body.ts` | 6c46484 |
| `src/browser/engine/page-renderer.ts` | 915da03 |
| `src/ui/components/content-renderer/content-renderer.ts` | 915da03 |
| `src/browser/rendering/html5-tokenizer.ts` | b3dbc32 |
| `tests/image-decoder.test.ts` | a89920a |
| `tests/formatting-contexts.test.ts` | 420c94e |
| `tests/page-renderer.test.ts` | 915da03 |

18 distinct files across 12 commits; 0 files created (`git diff --diff-filter=A a89920a^..b3dbc32` is empty).

## Files Created
None.

## Test Results
```
Full suite (final state, after b3dbc32): 216/216 files, 9182/9182 tests passing.
Playwright e2e (playwright-electron.config.cjs): 3/3 specs passing, including the
fidelity-audit fixtures now correctly sized at 1266x598 instead of a hardcoded 1920x1080.
Recurring pre-existing flake (unrelated to this arc): networking-integration.test.ts's
"DnsResolver - real system resolution" suite intermittently times out on sandboxed
localhost DNS; passed clean on the final run.
```

## Verification Steps
1. Each commit individually verified: `npm run typecheck` (clean), full `npx vitest run`, full `npx playwright test --config=playwright-electron.config.cjs`, and a live or saved-snapshot screenshot of news.ycombinator.com confirming the specific symptom was gone and no new one appeared.
2. The final two bugs (`4b03e13`, `b3dbc32`) were additionally confirmed via raw canvas pixel inspection (`ctx.getImageData()` rendered as ASCII) and a targeted in-process parser test respectively, before being folded into the full-suite/e2e verification above.
3. A final full-page screenshot of the live site after `b3dbc32` shows every title, domain-in-parens line, and subtext line rendering as clean, correctly wrapped, non-overlapping text with correct entity decoding.
