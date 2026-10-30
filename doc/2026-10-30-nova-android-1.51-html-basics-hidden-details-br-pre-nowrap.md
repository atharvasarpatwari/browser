# Nova Android 1.51: `[hidden]`, `<details>`, `<br>`, `<pre>`, `nowrap`, `text-transform`, Blockification

**Date:** 2026-10-30
**Session:** "keep improving the nova app and note the changes and update E:\nova_1\doc\analytics.html". A probe of everyday HTML/CSS found nine gaps; this round fixes six of them plus two found along the way.
**Status:** Completed (built and signed; not installed: no install requested this round)

---

## Summary
| Probe | Before | After |
|-------|--------|-------|
| `<p hidden>SECRET</p>` | Shown | Hidden (`[hidden] { display: none }`) |
| Closed `<details>` | Contents shown | Only its `<summary>` |
| `one<br>two` | A blank line between them | One line break; `<br><br>` = one blank line |
| `<pre>line1\n  line2</pre>` | One line, the newline drawn as a glyph | Two lines, indentation kept |
| `white-space: nowrap` | Wrapped | One line |
| `text-transform` | Ignored | `uppercase` / `lowercase` / `capitalize` |

Found along the way:
- `::before`/`::after` boxes took their **host's UA styles** (`div::before` was a block with the div's margins, `li::before` a second list item).
- Absolutely positioned and floated boxes were never **blockified**.

Still open from the probe: `text-overflow: ellipsis` (the "…"), `letter-spacing`, and `<sup>`/`<sub>` vertical alignment.

## Root Causes

### RC-1: `[hidden]` and closed `<details>` had no UA rule
**File:** `src/browser/rendering/css5/cascade.ts`
**Problem:** The UA defaults are keyed by tag only, so attribute-driven defaults never applied.
**Fix:**
- `hidden` (not `until-found`) → `display: none`.
- A child of a `<details>` without `open`, other than its first `<summary>`, → `display: none` (HTML §15.3.1, §15.5.4).
- Author CSS still overrides both.

### RC-2: Pseudo-elements took the host's UA defaults
**File:** `css5/cascade.ts`
**Problem:** `computeComputedStyles` in pseudo mode still applied `getUserAgentDefaults(host.tagName)`.
**Fix:** No UA defaults for `::before`/`::after`; they start from initial values (inline).

### RC-3: No blockification (CSS 2.2 §9.7)
**File:** `css5/cascade.ts`
**Problem:** `position: absolute|fixed` and `float` kept `display: inline`. RC-2 exposed this: an empty absolutely positioned `::before` with `height: 4px` became an inline element a line tall.
**Fix:** A `BLOCKIFY` map (inline → block, inline-flex → flex, inline-grid → grid, inline-table → table, table parts → block), applied at the end of the cascade.

### RC-4: `<br>` was an empty inline as wide as the line
**Files:** `src/browser/rendering/formatting/inline-context.ts`, `layout-engine.ts`
**Problem:** Nothing treated `<br>` as a line break. It took the full available width, which forced a wrap plus an extra line.
**Fix:**
- `InlineFormattingContext.lineBreak(lineHeight)` ends the line; an empty line still takes a line's height.
- The three inline child loops call it for `<br>`.

### RC-5: Preserved newlines didn't break lines; leading spaces were dropped
**File:** `inline-context.ts` `addTextRun`
**Problem:**
- Under `white-space: pre*`, a newline was kept as a character.
- Leading whitespace at the start of a line was skipped, even in `pre`.

**Fix:**
- A preserved segment is split at its newlines with `lineBreak`.
- The leading-whitespace skip applies only when whitespace collapses.

### RC-6: `nowrap` wrapped
**Files:** `inline-context.ts`, `layout-engine.ts`
**Problem:** Only collapsing was tied to `white-space`; wrapping always happened.
**Fix:** A `noWrap` flag on `addTextRun`, set for `nowrap` and `pre`, skips soft wrapping.

### RC-7: `text-transform` was ignored
**File:** `layout-engine.ts`
**Fix:** `transformText()` before the text is measured: `uppercase`, `lowercase`, and `capitalize` (letters after whitespace, brackets or quotes).
ponytail: `capitalize` restarts at each text node.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/css5/cascade.ts` | `[hidden]`, closed `<details>`; no UA defaults for pseudo-elements; `BLOCKIFY` |
| `src/browser/rendering/formatting/inline-context.ts` | `lineBreak()`; preserved newlines; pre keeps leading spaces; `noWrap` |
| `src/browser/rendering/layout-engine.ts` | `<br>` in the three inline loops; `noWrap()`; `transformText()` |
| `tests/generated-content-144.test.ts` | `ul { list-style: none }` beside a `li::before` bullet; position-based `::after` check (inline boxes paint in a later layer) |
| `android/app/build.gradle` | 1.51 (52) |
| `android/app/src/main/assets/*` | Rebuilt web bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/html-basics-151.test.ts` | 7 tests: `[hidden]` (an author display wins); closed/open `<details>`; `<br>` and `<br><br>`; `<pre>` newlines and indent; `nowrap`; `text-transform`; pseudo-elements without host UA styles (one marker) |
| `Nova-1.51.apk` | Signed build |

## Test Results
```
npx tsc --noEmit                                   -> clean
npx vitest run tests/html-basics-151.test.ts       -> 7 passed (7)
npx vitest run tests/generated-content-144.test.ts -> 9 passed (9)
npx vitest run                                     -> Test Files 303 passed (303), Tests 10745 passed (10745)
gradlew :app:testDebugUnitTest :app:assembleRelease -> BUILD OK
apksigner verify Nova-1.51.apk                     -> Verifies; versionCode 52, versionName 1.51
```
