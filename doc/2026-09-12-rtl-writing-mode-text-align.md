# RTL Direction + text-align — Wiring Parsed-But-Inert CSS Into Layout

**Date:** 2026-09-12
**Session:** Redline #07 from the "Nova Blueprint" self-audit — `direction`/`writing-mode` were parsed and correctly inherited but never consulted by layout.
**Status:** Completed (whole-page/whole-element RTL only — see Notes for explicit non-goals)

---

## Summary
`direction: rtl` on the `<html>`/`<body>` (the common real-world case — most RTL-language pages set it once at the root) had zero visual effect: content always laid out left-to-right regardless. Investigating turned up a second, larger latent gap in the same code path: `text-align` was not read anywhere in layout either — `left`/`center`/`right`/`justify` all silently did nothing, and content only ever *looked* left-aligned because boxes simply accumulate left-to-right from the line start. Fixing direction-aware alignment necessarily wires up basic `text-align` too, since resolving CSS's logical `start`/`end` keywords against `direction` is the same code path as physical `left`/`right`/`center`.

## Root Cause
`InlineFormattingContext.addBox()`/`pushTextSegment()` (`inline-context.ts`) always pack inline boxes left-to-right from `startX` — line-wrapping decisions themselves are direction-agnostic (whether a word fits on the current line doesn't depend on which edge it starts from), but nothing ever re-derived each box's *final* horizontal position afterward to account for alignment or direction. `direction`/`writing-mode` were correctly parsed, normalized, and inherited by the CSS cascade (`property-definitions.ts`, `cascade.ts`) — the gap was entirely in layout, not CSS.

## What Was Built
- `InlineFormattingContext` gained two new options: `direction: 'ltr'|'rtl'` and `textAlign: 'left'|'right'|'center'|'justify'`.
- `finalize()` now re-derives each line's boxes' final `x` in one pass: the existing left-to-right accumulation is treated as the "logical order," then mirrored for `rtl` and offset for alignment. Line-wrapping/measurement code is untouched — only the final visual `x` changes.
- `layout-engine.ts`'s two `InlineFormattingContext` construction sites (`layoutInlineChildren`, `layoutAnonymousBlock`) now read the parent element's computed `direction` and resolve `text-align` (`start`/`end` → physical `left`/`right` based on direction; `left`/`right` stay physical per spec, never flipping) via a new `resolveTextAlign()` helper.

## Notes — explicit non-goals
- **No bidi.** This handles whole-element direction (an entire RTL-language paragraph/page), not the Unicode Bidirectional Algorithm for mixed LTR/RTL runs within one line (e.g. an English word embedded in an Arabic sentence). That's a materially larger, separate feature.
- **No vertical writing-modes.** `writing-mode: vertical-rl/vertical-lr` still has no layout effect — only horizontal `direction` was addressed this pass.
- **Alignment/mirroring is computed against the line's full `availableWidth`, not a per-line float-narrowed width** (`getAvailableWidthAt(line.y)` would be the precise value). Marked with a `ponytail:` comment in the code — correct for the common case (RTL text without floats sharing the line), a real but narrow gap if a future page combines RTL with float-narrowed lines.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/rendering/formatting/inline-context.ts` | Added `direction`/`textAlign` constructor options; `finalize()` now computes final horizontal position per box (alignment offset + RTL mirroring) |
| `src/browser/rendering/layout-engine.ts` | Added `resolveTextAlign()` helper; both `InlineFormattingContext` construction sites now resolve and pass `direction`/`textAlign` from the parent's computed style |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-09-12-rtl-writing-mode-text-align.md` | This document |

## Test Results
```
npx tsc --noEmit -p .                                            → 0 errors (repo-wide)
npx vitest run                                                    → 222 files / 9216 tests passed
npx playwright test --config=playwright-electron.config.cjs       → 3/3 passed, including the full
  12-fixture fidelity-audit visual regression suite (identical
  nonWhite/cluster metrics to before this change — no regression)
  plus a scratch RTL/text-align fixture used to verify this feature,
  since deleted
```

## Verification Steps
1. Built a fixture with `direction:rtl` on `<body>` containing the text "one two three", plus two `direction:ltr` divs with `text-align:center` and `text-align:right`.
2. Screenshotted the real rendered output: the RTL line showed the words visually left-to-right as "three two one" — the correct mirrored result, since reading it right-to-left (as an RTL reader would) gives the correct logical order "one two three," with "one" placed at the line's rightmost (starting) position.
3. Confirmed `text-align:center` visually centered its text and `text-align:right` right-aligned it within their boxes — both previously complete no-ops.
4. Ran the full fidelity-audit e2e suite (12 diverse fixtures) and confirmed identical pixel metrics to the pre-change baseline, confirming no regression to ordinary LTR/left-aligned content (the vastly more common case).
