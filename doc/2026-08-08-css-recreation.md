# CSS Recreation — styles.css Rewritten from Scratch

**Date:** 2026-08-08
**Session:** Full rewrite of the Nova Browser stylesheet
**Status:** Completed

---

## Summary

Recreated `styles.css` from scratch as a clean, hand-written 8-layer cascade design system (~2,900 lines / 88.7 KB). Drop-in compatible: all 473 component/utility classes and all 160 design tokens from the previous file are preserved, and every CSS custom property referenced by the TypeScript source is defined.

## Architecture Decisions

### Layered Structure
The stylesheet is organized into 8 cascade layers (declared once at the top):
1. **reset** — box-model normalization, form/image element resets
2. **tokens** — full token system (dark-first on `:root`, light theme via `@media (prefers-color-scheme: light)`)
3. **base** — global element defaults, scrollbars, focus, selection
4. **layout** — browser shell, desktop layout, mobile layout, address bar, tab bar, status bar
5. **components** — chrome, menus/dropdowns/context menus, tooltips, modals, toasts, suggestions, settings, shield/privacy, motion tracker, empty states, trees, pages, webview placeholder, lists, progress/spinner/skeleton, badges, glass, buttons, toggle switches
6. **utilities** — atomic utilities (display, flex, spacing, typography, colors, borders, radius, shadows, opacity, transforms, transitions, position, size, grid, cursor, overflow, selection, z-index)
7. **animations** — 20 keyframes + animation utility classes + fill modes + delay utilities
8. **overrides** — responsive breakpoints, reduced motion, high contrast, RTL, print

### Key Decisions
- **Logical properties** (`inset-inline`, `margin-inline`, `padding-inline`, `border-inline-*`, `text-align: start`) used throughout for built-in RTL support.
- **Dark theme is the authored default**; light theme tokens are overlaid in `prefers-color-scheme: light`.
- **Nova Browser legacy `--nb-*` tokens** (`--nb-accent`, `--nb-bg`, `--nb-surface`, `--nb-text`, …) are retained and aliased to the main token system because components reference them.
- **`nova-spin` keyframe** kept at the exact name used by `content-renderer.ts` inline `animation:nova-spin`.
- Drop-in class coverage verified programmatically: 0 missing of the 473 old classes; 0 missing of the 160 old tokens; 0 missing of the 34 tokens referenced in `src/`.

## Files Modified

| File | Change |
|------|--------|
| `E:\nova_1\styles.css` | Complete rewrite from scratch (8 cascade layers, 2,900 lines) |
| `E:\nova_1\assets\static\styles.css` | Synced copy of the new stylesheet |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-08-08-css-recreation.md` | This changelog |

## Test Results

```
> npx postcss styles.css --no-map
POSTCSS_EXIT=0            (parses with zero errors/warnings)

> npx vitest run tests/wpt/css-spec.test.ts
Test Files  1 passed (1)
Tests       105 passed (105)

Coverage diff (old vs new):
  classes:  473 old → 473 new, missing 0
  tokens:   160 old → 160 new, missing 0
  src-referenced tokens: 34/34 defined
```

## Verification Steps

1. `npx postcss styles.css --no-map` → exit 0, no parse errors
2. Extracted all `.class` selectors from `git show HEAD:styles.css` and diffed against the new file → **0 missing**
3. Extracted all `--token:` definitions from `git show HEAD:styles.css` → **0 missing**
4. Grepped every `var(--token)` reference in `src/**/*.ts` and confirmed each is defined → **34/34**
5. Ran the CSS-spec Vitest suite → **105/105 pass**
6. Copied the file to `assets/static/styles.css` and confirmed identical hashes

## Notes

- No TypeScript/HTML changed; the stylesheet is a drop-in replacement, so JS behavior is unaffected.
- The 5 pre-existing `tests/dev-proxy-http-client.test.ts` failures and the `nova-dev-proxy.ts` typecheck error reported in the 2026-08-08 status session are unrelated to this change.
