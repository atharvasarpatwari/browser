# The HTML5 Parser Corrupted Every Realistically-Formatted Page — Every Page Rendered Blank

**Date:** 2026-09-17
**Session:** Asked to run the web build and test the parsing. Every real page (a real external site, and controlled local fixtures) loaded and committed correctly — history, address bar, and tab title all updated — but the canvas stayed completely blank: zero non-white pixels, on every single page tried.
**Status:** Completed

---

## Summary
Nothing about this was a rendering, layout, or paint bug — the actual HTML5 tree-construction algorithm was silently building a corrupted DOM tree for any HTML containing ordinary whitespace between tags in `<head>` (i.e. any HTML a human ever pretty-printed — a real fetched page would hit this every time). `<style>` and the real page content ended up nested inside a phantom second `<head>` element that was itself misplaced as a child of `<body>`, so layout's block-level walk from `document.bodyElement` found only that one phantom child and never reached the real `<h1>`/`<p>` elements at all — leaving `layoutBoxes` with a single entry and nothing to paint.

Traced end to end: HTML tokenized correctly (27 well-formed tokens, verified byte for byte), `DomTree.buildFromHtml()` faithfully converts what it's given, layout/paint/rasterizer all ran without error — the corruption was already present in the tree-builder's own output, before any of those later stages touched it. Isolating `Html5Tokenizer` + `TreeBuilder` directly (bypassing every wrapper) reproduced it deterministically, and it disappeared the moment all whitespace between head-level tags was removed — pinning it to the "in head" insertion mode specifically.

## Root Causes

1. **`handleInHead()` had no `case 'text'` in its token-kind switch, so every text token — whitespace included — fell through to the "unexpected content" error-recovery path meant only for real content.** Every sibling insertion-mode handler in this file family (`before-html.ts`, `before-head.ts`, `initial.ts`) has the same shape: `case 'text': if (whitespace) break/return; ...else fall through to recovery...`. `handleInHead()` in `src/browser/rendering/html5/modes/head.ts` was missing this case entirely. So the newline after `<head>`, or the newline before `<style>`, or the newline before `</head>` — completely insignificant per the HTML5 spec — instead triggered: parse-error, pop `<head>` off the open-elements stack, switch to "after head", and reprocess the same whitespace token there. "After head" then (mis)handled it too (see Notes) and created `<body>` **immediately**, long before the real `<body>` tag was ever seen. Every subsequent token — the real `<style>`, the real `</head>`, the real `<body>`, `<h1>`, `<p>` — was then processed against this already-wrong insertion-mode state, and the HTML5 spec's own "in body" fallback rule for metadata tags (redirect `<style>`/`<link>`/etc. back to "in head" handling) is what produced the specific phantom-head-inside-body shape observed. Fixed by adding the same whitespace-aware `case 'text'` every sibling handler already has: whitespace returns immediately (stays in "in head", correctly ignored), anything else still falls through to the existing, correct recovery path.

## Notes
- `handleAfterHead()`'s own whitespace handling (`if (whitespace) break;` falling through to "insert `<body>` and reprocess") is also not strictly spec-correct — per §13.2.6.6, whitespace here should just be inserted into the current node without creating `<body>` at all. It didn't matter for this bug once the root cause was fixed (whitespace no longer reaches "after head" prematurely on a real document), and touching it wasn't necessary to fix what was actually broken — left as-is rather than opportunistically rewriting a second insertion mode's behavior beyond what this bug required.
- This is a foundational, shared parser used by literally every page load, so the diagnosis leaned hard on isolation before touching anything: confirmed the tokenizer's output byte-for-byte, confirmed `DomTree.buildFromHtml()` faithfully converts a correct input, and confirmed a compact (whitespace-free) version of the exact same HTML parsed correctly — narrowing the bug to one specific insertion mode before reading a single line of its code.
- Existing coverage in `tests/html5-error-recovery.test.ts`'s "in head" describe block never caught this because every existing case there uses compact, single-line HTML with no whitespace between tags (e.g. `'<head><title>Hello</title><style>.a{}</style></head><body>ok</body>'`) — which never exercises the code path that broke. Real-world and any hand-written HTML almost always has whitespace between tags, which is exactly why this reproduced immediately on both a real external site and a hand-written local test fixture, yet was invisible to the existing test suite.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/html5/modes/head.ts` | Added a `case 'text'` to `handleInHead()`: whitespace-only text returns immediately (ignored, stays in "in head" mode); non-whitespace text still falls through to the existing "anything else" recovery |
| `tests/html5-error-recovery.test.ts` | Added a test to the existing "in head" describe block asserting `<style>` stays under `<head>` and `<h1>`/`<p>` land directly under `<body>` for realistically-whitespaced HTML |

## Files Created
- `doc/2026-09-17-html5-parser-in-head-whitespace-corrupted-every-real-page.md` — this document

## Test Results
```
npx tsc --noEmit -p .                                    → 0 errors (repo-wide)
npx vitest run tests/html5-error-recovery.test.ts         → 123/123 passed (1 new)
npx vitest run (full suite)                               → 223 files / 9268 tests passed (0 regressions)
```

## Verification Steps
1. Ran the web app (`npm run dev` via a fixed `.claude/launch.json`) and navigated to a real external site and a local static fixture; both committed navigation successfully (address bar, tab title, history all updated) but painted a completely blank canvas — confirmed via direct pixel sampling (`getImageData`), not just a screenshot.
2. Instrumented `putImageData`/`fillRect`/`fillText` on the live rasterizer: found ~500+ full-canvas `putImageData` calls (paint genuinely runs) but zero `fillText` calls and only two `fillRect` calls, both white, at wrong positions — pointing at layout, not paint.
3. Instrumented `LayoutEngine.layout()` directly: `layoutBoxes` ended up with exactly one entry after a full layout pass, for `<body>` itself — `layoutNode()` never descended into body's real children at all.
4. Instrumented `DomTree.buildFromHtml()`'s output directly: found a phantom `<head>` element nested as a child of `<body>`, containing `<style>`/`<h1>`/`<p>` — the real content, in the wrong place.
5. Traced upstream: confirmed via a byte-for-byte tokenizer dump that `Html5Tokenizer` produces a perfectly well-formed 27-token stream for the test HTML — ruling out the tokenizer.
6. Isolated `Html5Tokenizer` + `TreeBuilder` directly (bypassing `HtmlParser`'s wrapper and every later pipeline stage) and reproduced the corrupted tree deterministically from the token stream alone.
7. Bisected by content: the same HTML with all whitespace between head-level tags removed parsed correctly; reintroducing newlines between `<head>`/`<style>`/`</head>` reproduced the corruption every time — pinning the bug to whitespace handling in "in head" mode specifically.
8. Read `handleInHead()` in `head.ts` and found it has no `case 'text'` at all, unlike every sibling insertion-mode handler in the same directory — confirming the exact missing case.
9. Added the fix, re-ran the isolated tokenizer+tree-builder repro (now correct), then re-ran the full app: the local fixture rendered its red heading and dark paragraph text as real pixels (verified by color-counting the canvas: 6672px of `#c0392b`, 3712px of `#222222`), and a script-driven DOM mutation fixture additionally showed 1040px of `#0000ff` from JS-set text — confirming HTML, CSS, and JS all now render correctly end to end.
10. Added a regression test to the existing "in head" describe block using realistically-whitespaced HTML, ran the full suite for regressions.
