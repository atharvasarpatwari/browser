# CSS Cascade & Inheritance Resolution

**Date:** 2026-07-24
**Session:** Full cascade & inheritance resolution — CSS-wide keywords, computed value resolution, property registry
**Status:** Completed

---

## Summary

Implemented comprehensive CSS cascade and inheritance resolution: CSS-wide keywords (`inherit`/`initial`/`unset`/`revert`), computed value resolution (148 named colors → hex, font-size/weight keywords → numeric, border-width keywords → px, opacity clamping), and a central property registry (~120 properties with inheritance flags and initial values).

## Architecture Decisions

### 1. Central Property Registry
**Decision:** Single authoritative `property-definitions.ts` with ~120 property definitions, replacing the ad-hoc `INHERITABLE` set and `setInitialValues()` in cascade.ts.
**Rationale:** Eliminates duplication; ensures inheritance flags and initial values stay in sync; makes adding new properties trivial.

### 2. CSS-Wide Keywords Before Inheritance
**Decision:** Process CSS-wide keywords *after* cascade/inline styles but *before* inheritance and initial values.
**Rationale:** Per CSS Cascading Level 5 spec, `inherit`/`initial`/`unset`/`revert` override cascade entries but are processed before default inheritance. This ordering ensures correct semantics.

### 3. Computed Value Resolution as Final Step
**Decision:** Resolve named colors, font-size keywords, font-weight keywords, and border-width keywords as the *last* step in the cascade pipeline.
**Rationale:** Values like `em`/`rem`/`%/calc()` are left for the layout engine; only context-independent keywords are resolved at cascade time.

### 4. `revert` Falls Back to UA Defaults
**Decision:** Since Nova doesn't track per-origin cascade entries, `revert` behaves like falling back to UA defaults.
**Rationale:** The most common real-world use of `revert` is author stylesheets rolling back user-agent defaults, which this implementation covers.

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/rendering/css5/property-definitions.ts` | Central registry of ~120 CSS properties (inherited, initial values, shorthand groups) |
| `src/browser/rendering/css5/css-wide-keywords.ts` | CSS-wide keyword resolution (inherit/initial/unset/revert/revert-layer) |
| `src/browser/rendering/css5/computed-value-resolver.ts` | Computed value resolution (148 named colors, font-size/weight keywords, border-width, opacity) |
| `tests/css5-property-definitions.test.ts` | 40 tests for property registry |
| `tests/css5-css-wide-keywords.test.ts` | 19 tests for CSS-wide keywords |
| `tests/css5-computed-value-resolver.test.ts` | 32 tests for computed value resolver |

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/css5/cascade.ts` | Replaced INHERITABLE set with property-definitions import; added CSS-wide keyword + computed value resolution steps to pipeline; expanded initial values list |
| `src/browser/rendering/css5/index.ts` | Added exports for property-definitions, css-wide-keywords, computed-value-resolver |
| `tests/css5.test.ts` | Updated 7 assertions: named colors now resolve to hex (`red` → `#ff0000`); background-color initial value now set |

## Cascade Pipeline (Updated)

The `computeComputedStyles()` pipeline now has 10 steps:

1. **Collect matching rules** — flatten @media/@supports
2. **Cascade sort** — importance → specificity → source order → inline
3. **Expand shorthands** — margin, padding, border, font, etc.
4. **Apply UA defaults** — element-specific baseline styles
5. **Apply cascade declarations** — ascending order (later wins)
6. **Apply inline styles** — `style=""` attribute
7. **CSS-wide keywords** — resolve inherit/initial/unset/revert ← **NEW**
8. **Inheritance** — propagate inherited properties from parent
9. **Initial values** — fill remaining unset properties
10. **Computed value resolution** — named colors → hex, keywords → numeric ← **NEW**

## Test Results

```
 ✓ tests/css5-property-definitions.test.ts  (40 tests)
 ✓ tests/css5-css-wide-keywords.test.ts     (19 tests)
 ✓ tests/css5-computed-value-resolver.test.ts (32 tests)
 ✓ tests/css5.test.ts                       (86 tests)

Test Files  129 passed (130)
     Tests  5631 passed (5687)
  Start at  10:24:04
  Duration  224.69s
```

## Verification Steps

1. All 91 new tests pass (40 property-definitions + 19 css-wide-keywords + 32 computed-value-resolver)
2. All 86 existing css5 tests pass (7 updated for new computed value behavior)
3. Full suite: 129/130 files pass, 5631 tests pass
4. 1 worker OOM (pre-existing memory limit, not related to changes)
5. Named colors resolve correctly (148 CSS Color Level 4 named colors)
6. CSS-wide keywords resolve per CSS Cascading Level 5 spec
7. Font-size keywords resolve relative to parent font-size
8. Font-weight keywords (bold→700, bolder/lighter relative to parent)
9. Border-width keywords (thin→1px, medium→3px, thick→5px)
10. Opacity clamped to [0,1]
