# Nova Android 1.71: Real-Page Renders in Node — Shrink-to-Fit Floats, Empty and Hidden Inlines

**Date:** 2026-11-01
**Session:** "keep improving the nova app" — with the tablet still disconnected, the saved real pages were rendered through Nova's full pipeline in Node and inspected as PNGs
**Status:** Completed (no APK built this round: the session's usage limit was reached; tests pass)

---

## Summary

Six saved real pages (Wikipedia article, Google search, example.com, IANA, httpbin form, httpforever) were rendered at phone (412px) and tablet (1070px) widths with Nova's CPU rasterizer and viewed. Wikipedia and httpforever looked right apart from images and icons (no network or SVG decoding in the harness), with two real bugs visible: a Wikipedia sentence broke in two at "As of 2026 | , the most used …", and IANA's header menu stacked vertically instead of in a row. Both root causes were general and are fixed.

## Root Causes

### 1. Auto-width floats took the whole line
**File:** `src/browser/rendering/layout-engine.ts`
**Problem:** `layoutFloatElement`'s "shrink-wrap to content" branch actually used the full available width, so every `li { float: left }` menu item was a full line and the items stacked.
**Fix:** shrink-to-fit per CSS 2.2 §10.3.5 with `measureContentWidth` (the measure absolute boxes already use).

### 2. Empty inline elements took a whole line
**File:** `layout-engine.ts`
**Problem:** `flowInlineElement` sent every childless inline to the replaced-element path, which sized it like an inline-block across the line. Wikipedia's empty `<span typeof="mw:Nowiki">` broke sentences.
**Fix:** only replaced elements (`REPLACED_TAGS`: img, video, canvas, iframe, svg, form controls…) take that path; an empty `<span>` is an ordinary zero-width inline.

### 3. display:none inside a line was laid out
**File:** `layout-engine.ts`
**Problem:** the three inline layout loops never checked `display: none`, so a hidden inline (Wikipedia's `<sup style="display:none">[update]</sup>`) took room unpainted.
**Fix:** skipped in `layoutInlineChildren`, `layoutAnonymousBlock` and `flowInlineElement`.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | shrink-to-fit floats, `REPLACED_TAGS`, display:none skip in inline loops (#1–#3) |
| `tests/layout-engine.test.ts` | an old expectation encoded #2 (empty inlines wrapping onto their own line); now asserts same line, zero width |

## Files Created

| File | Purpose |
|------|--------|
| `tests/real-page-fixes-171.test.ts` | floated menu items in a row at the right edge; empty/hidden inlines don't break a line (2 tests) |

## Verification

- Renders (Node, Nova's rasterizer): Wikipedia's lead paragraph now flows "… consoles. As of 2026, the most used browsers …"; a float-in-float probe puts the menu items side by side at the right edge.
- Full suite: 318 files / 11071 passed.
- Not done this round: APK build and device check (tablet disconnected; usage limit reached).

## Test Results

```
npx tsc --noEmit                                    → clean
npx vitest run tests/real-page-fixes-171.test.ts    → 2 passed
npx vitest run                                      → Test Files 318 passed (318); Tests 11071 passed (11071)
```
