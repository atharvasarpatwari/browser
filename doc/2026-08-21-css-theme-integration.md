# CSS Theme Integration — Dark-Glass Minimalism

**Date:** 2026-08-21
**Session:** Integrate `css_1.css` theme into Nova UI pipeline
**Status:** Completed

---

## Summary

Replaced the root `styles.css` with the new dark-glass minimalism theme from `new/css_new/css_1.css`, added backward-compatible CSS variable bridges so all 34 inline-style `var()` references continue to resolve, and linked the stylesheet in `index.html`. The new design uses an obsidian/cyan palette with DM Sans/DM Mono/Playfair Display fonts.

## Changes

### 1. Replaced `styles.css` (3,326 lines → ~1,100 lines)

**File:** `styles.css`
**Problem:** The old stylesheet used a blue/purple accent (`#6f8cff`) with a different token naming convention (`--bg-body`, `--text-primary`, etc.) and was never linked to the app.

**Fix:** Replaced entirely with the new theme content from `css_1.css` plus:
- 34 bridging CSS custom property aliases in `:root` for backward compatibility
- Missing sections 23–37 (context menu, dialogs, toasts, progress, dropdowns, find-in-page, permission prompts, scrollbars, focus styles, keyframe animations, light mode, high contrast, responsive, reduced motion)
- Light mode override that maps obsidian palette values to light equivalents
- High contrast, responsive (tablet/mobile), and reduced-motion media queries

### 2. Linked stylesheet in `index.html`

**File:** `index.html`
**Problem:** No stylesheet was linked; the UI relied entirely on inline `style.cssText` with `var()` fallback values.

**Fix:** Added `<link rel="stylesheet" href="/styles.css">` before the inline `<style>` block.

### 3. Backward-compatible bridging variables

34 CSS custom property aliases ensure existing inline styles continue to work:

| Old Name (inline refs) | New Name (theme tokens) | Value |
|---|---|---|
| `--bg-body` | `--bg-base` | `var(--bg-base)` |
| `--bg-elevated` | `--bg-surface-2` | `var(--bg-surface-2)` |
| `--bg-overlay` | — | `rgba(6,8,16,.75)` |
| `--text-primary` | `--tx-primary` | `var(--tx-primary)` |
| `--text-secondary` | `--tx-secondary` | `var(--tx-secondary)` |
| `--text-tertiary` | `--tx-tertiary` | `var(--tx-tertiary)` |
| `--text-danger` | — | `var(--red-400)` |
| `--text-success` | — | `var(--green-400)` |
| `--text-accent-bright` | — | `var(--cyan-300)` |
| `--accent-dim` | — | `rgba(6,182,212,.08)` |
| `--accent-hover` | `--accent-lt` | `var(--accent-lt)` |
| `--border-subtle` | `--bd-subtle` | `var(--bd-subtle)` |
| `--border-default` | `--bd-default` | `var(--bd-default)` |
| `--border-accent` | `--bd-accent` | `var(--bd-accent)` |
| `--radius-sm` | `--r-2` | `var(--r-2)` |
| `--radius-md` | `--r-3` | `var(--r-3)` |
| `--toggle-on-bg` | `--accent` | `var(--accent)` |
| `--toggle-off-bg` | `--bg-surface-2` | `var(--bg-surface-2)` |
| `--t-fast` | `--dur-fast` | `var(--dur-fast)` |
| `--nb-bg` | `--bg-base` | `var(--bg-base)` |
| `--nb-text` | `--tx-primary` | `var(--tx-primary)` |
| `--nb-font-body` | `--font-ui` | `var(--font-ui)` |
| `--nb-surface` | `--bg-surface` | `var(--bg-surface)` |
| `--nb-border` | `--bd-subtle` | `var(--bd-subtle)` |
| `--nb-radius` | `--r-4` | `var(--r-4)` |
| `--nb-accent` | `--accent` | `var(--accent)` |
| `--nb-accent-soft` | — | `rgba(6,182,212,.1)` |
| `--nb-text-muted` | `--tx-tertiary` | `var(--tx-tertiary)` |
| `--nb-surface-hover` | `--bg-hover` | `var(--bg-hover)` |
| `--nb-danger` | — | `var(--red-400)` |
| `--nb-font-mono` | `--font-mono` | `var(--font-mono)` |

## Files Modified

| File | Change |
|------|--------|
| `styles.css` | Replaced with new dark-glass theme + bridges + sections 23–37 |
| `index.html` | Added `<link rel="stylesheet" href="/styles.css">` |

## Files Created

| File | Purpose |
|------|---------|
| — | (none) |

## Files Read (reference)

| File | Purpose |
|------|---------|
| `new/css_new/css_1.css` | Source for new theme (1,261 lines) |
| `src/ui/**/*.ts` | Audited 34 unique CSS var() references used in inline styles |

## Test Results

```
npx tsc --noEmit       → 0 errors
npx vitest run         → 195/195 files, 8947/8947 tests passed
npx vite build         → built in 10.96s
```

## Verification Steps

1. Confirmed `styles.css` was not previously imported by any TS or HTML file
2. Audited all 21 `src/ui/**/*.ts` files for CSS variable usage (34 unique vars)
3. Mapped each old variable name to the new theme token
4. Replaced `styles.css` with complete theme + bridges + missing sections
5. Linked in `index.html` before the inline `<style>` block
6. Ran `npx tsc --noEmit` — 0 errors
7. Ran `npx vitest run` — 195 files, 8947 tests pass
8. Ran `npx vite build` — successful
