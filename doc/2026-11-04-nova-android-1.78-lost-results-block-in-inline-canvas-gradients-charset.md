# Nova Android 1.78: Lost-Result Audit — Block-in-Inline Overlap, Canvas Fill Rule, Radial Gradient Shape/Size, Meta Charset Order

**Date:** 2026-11-04
**Session:** "make a new version changes in the app and make sure all the test cases are been satisfied … identified by the root cause … notified in the analytics page for the tracking" (second round)
**Status:** Completed (APK built; the tablet was not connected, so it is not installed)

---

## Summary
This round's first full run of every check was **all green**:

| Check | Result |
|---|---|
| Vitest | 325 files, 11362 tests passed |
| `tsc` | clean |
| ESLint | 0 errors |
| Android unit tests | OK |

So the search for hidden errors moved to ESLint's **"assigned a value but never used"** warnings in `src/`, 90 of them. In 1.77 exactly such a warning (a never-read variable) exposed the empty-`history.state` bug. The rendering and parsing ones were read one by one, and four turned out to be lost results with visible effects. An 11-case probe confirmed all four (4/11 passed first) before any fix, and **11/11** pass after.

Saved real pages, old vs new code in the same environment, Wikipedia article and search, IANA, httpforever, example.com and httpbin at 412 and 1070px: **0 px changed**. The fixes only affect markup those pages don't use.

## Root Causes

### 1. A block inside an inline element overlapped the content after it
**File:** `src/browser/rendering/layout-engine.ts` (`layoutInlineChildren`, `flowInlineElement`), `formatting/inline-context.ts`
**Problem:** with `<a href>before<div style="height:50px">card</div>after</a><div>next</div>`, a card link (very common), the next block started at y=20, inside the card. With `<span><div>40px</div></span><p>`, the paragraph was drawn over the block.
**Root cause:**
- Both inline paths laid the block out with `layoutNode(…, ifc.getEndY(), …)` and threw its result away (`const savedY = …`, the unused value lint flagged, with the comment "We just advance the IFC").
- Nothing advanced the inline formatting context, so the following lines, and the parent's height, continued from where the block started.

**Fix:** `InlineFormattingContext.breakForBlock(height)`:
- it ends the line before the block, reserves the block's height as a spacer line (no strut), and starts the next line below it;
- an empty line left after the block takes no height.

Both paths call it before and after laying out the block.

### 2. Canvas fill() always used the even-odd rule
**File:** `src/browser/rendering/canvas/canvas-context.ts` (`fill`, `_scanlineFill`)
**Problem:** `ctx.rect(0,0,30,20); ctx.rect(10,0,30,20); ctx.fill()` left a hole where the two rectangles overlap. Browsers fill it, because nonzero is the default rule.
**Root cause:**
- `fill(fillRule)` never passed `fillRule` on (lint: unused).
- The scanline fill drew between pairs of sorted crossings ("nonzero winding", its comment said), which is the even-odd rule.
- Both edge endpoints counted, so a vertex shared by two edges could be counted twice.

**Fix:**
- Crossings record the edge's direction, and spans are filled where the winding is non-zero (`nonzero`) or the crossing count is odd (`evenodd`).
- Edges are half-open, [top, bottom).

### 3. radial-gradient() shape and size were parsed and then ignored
**File:** `src/browser/rendering/css-gradients.ts` (`evaluateGradient`)
**Problem:** in a 200×100 box, `radial-gradient(circle, …)` was an oval, with a different colour at 40px across than at 40px down. `closest-side` and `farthest-side` spots were the wrong size.
**Root cause:** `const { shape, size } = grad` were destructured and never used (lint). Without explicit radii, every radial gradient was a farthest-corner ellipse in box-relative units.
**Fix:** the ending shape follows CSS Images §3.2.2:
- **`circle`:** the distance from the centre to the closest or farthest side, or to the closest or farthest corner.
- **`ellipse`:** side radii per axis; the corner sizes keep the side aspect ratio and pass through the corner.

The default (`ellipse farthest-corner`) gives the same result as before.

### 4. A meta charset with content before http-equiv was missed
**File:** `src/browser/rendering/html5/encoding.ts` (`prescanMetaCharset`)
**Problem:** `<meta content="text/html; charset=windows-1252" http-equiv="Content-Type">` detected nothing, so the page decoded with the fallback encoding (mojibake for accented text).
**Root cause:**
- The prescan accepted `content` only after it had seen `http-equiv`.
- It had a `foundCharset` variable for the spec's collect-then-decide step, but it was a `const false` and never used (lint).

**Fix:** a charset found in `content` is kept and used once `http-equiv="content-type"` has been seen, in either order.

## Not changed (recorded)
- **`clip()`** still intersects with the path's bounding box, so it ignores the fill rule (`ponytail:`).
- **Float placement** still approximates a float's height with its width while scanning (`float-context.ts`).
- **The other 86 unused-value warnings** in `src/` were read and are dead values left over from refactors. Most are unused constants and helpers in the WebAssembly code generator (`wasm-codegen.ts`).

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | block-in-inline advances the lines (#1) |
| `src/browser/rendering/formatting/inline-context.ts` | `breakForBlock`, spacer lines in `finalize` (#1) |
| `src/browser/rendering/formatting/types.ts` | `LineBox.spacer` (#1) |
| `src/browser/rendering/canvas/canvas-context.ts` | nonzero / evenodd fill, half-open edges (#2) |
| `src/browser/rendering/css-gradients.ts` | radial shape and size (#3) |
| `src/browser/rendering/html5/encoding.ts` | meta charset in either attribute order (#4) |
| `android/app/build.gradle` | 1.77 (78) → 1.78 (79) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/lost-results-178.test.ts` | the 11 probe checks as a permanent test |

## Test Results
```
Before (first full pass):
  npx vitest run         → Test Files 325 passed (325); Tests 11362 passed (11362)
  npx tsc --noEmit       → clean
  npx eslint src/ tests/ → 0 errors, 1010 warnings (90 "assigned a value but never used" in src/, audited)
  gradlew :app:testDebugUnitTest → OK

Probe of the four suspected lost results (11 checks) → 4/11 before any fix
  block-in-inline ×2 FAIL (next block at the block's top) · canvas nonzero FAIL · radial ×3 FAIL · meta content-first FAIL
  after #1 → 6/11, #2 → 7/11, #3 → 10/11, #4 → 11/11

After:
  npx vitest run         → Test Files 326 passed (326); Tests 11363 passed (11363)
  npx tsc --noEmit       → clean
  npx eslint src/ tests/ → 0 errors, 1005 warnings
  Real pages, old vs new code, same environment (6 pages × 412/1070) → 0 px difference
  gradlew :app:testDebugUnitTest :app:assembleRelease → OK
  apksigner verify Nova-1.78.apk → verified; versionCode 79, versionName 1.78
  adb devices            → none (not installed)
```
