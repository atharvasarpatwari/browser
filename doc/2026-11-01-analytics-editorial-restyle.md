# Analytics Dashboard — Editorial Restyle

**Date:** 2026-11-01
**Session:** Restructure doc/analytics.html — new style, new font, new information
**Status:** Completed

---

## Summary
Restyled the documentation analytics dashboard from dark glassmorphism to a **clean editorial** look (flat high-contrast surfaces, crisp borders, generous whitespace, light-first), swapped the heading font to **Space Grotesk** (body stays Inter), and added two new metric views — **Cadence & Streaks** and **Recent Sessions**.

## Changes

### 1. New style — editorial, flat, light-first
**File:** `doc/analytics.html`
**What changed:**
- Repointed the `--glass*` CSS tokens to opaque editorial surfaces and appended an "Editorial flat surfaces" override block that neutralizes the whole glassmorphism layer at once: no `backdrop-filter`, no translucent fills, animated background blobs hidden (`.bg-blob{display:none}`), neon KPI glows replaced with soft neutral shadows.
- New token set in both themes: `--card`, `--border`, `--hairline`, `--fill`, `--shadow`/`--shadow-hover`/`--shadow-lg`. Light-first palette (`#f6f7f9` page / `#ffffff` cards / `#e3e5ea` borders / `#16181d` ink); editorial dark palette for dark mode.
- Light-mode table/row/changelog separators now use `--hairline` (the old `rgba(255,255,255,0.03)` hairlines were invisible on light backgrounds).
- Body centered at `max-width:1320px` with airier padding.
- Default theme flipped to **light** (`<html data-theme="light">` + rewritten `applySystemTheme` → light unless the OS prefers dark).

### 2. New font
- Google Fonts link `Sora` → `Space Grotesk`; `--font-head` updated. Inter retained for body.

### 3. New information — added metric sections
- **Cadence & Streaks**: current streak, longest streak (all-time-best flag), active days over calendar span, consistency %, docs/active-day, busiest weekday — all computed from `DOCS` at render.
- **Recent Sessions**: the six most recent docs as clickable cards (open the existing doc modal via `openModal`).
- Nav pills + command-palette scroll-spy extended with `cadence` and `recent`.

## Files Modified
| File | Change |
|------|--------|
| `doc/analytics.html` | Editorial restyle (tokens + flat-surface override block), Space Grotesk font, light-first default, Cadence/Streaks + Recent Sessions sections and render JS, nav + scroll-spy entries, new DOCS entry for this session |
| `doc/README.md` | Updated Analytics section description + indexed this change log |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-11-01-analytics-editorial-restyle.md` | This change log |

## Test Results
No unit suite for the static dashboard; verified by serving `doc/` over HTTP and loading in a real browser.

```
python -m http.server 8766 --directory doc
GET /analytics.html            -> 200
GET /analytics-churn.js        -> 200
console errors (live page)     -> none  (one stale 404 was a wrong-dir first attempt)
Chart.js charts                -> render (bar + donut confirmed)
Cadence & Streaks              -> populated (streak 3d, consistency 64%, 5.3 docs/active day, busiest Sun)
Recent Sessions                -> 6 cards rendered
streak invariant self-check    -> console.assert(cur<=longest<=activeDays<=span) passed
light + dark themes            -> both render flat/editorial
```

## Verification Steps
1. Served `doc/` via `python -m http.server`, loaded `analytics.html` in the in-app browser.
2. Checked console (no errors) and network (all 200) on the live page.
3. Confirmed charts render, new Cadence/Recent sections populate, and the streak self-check passes.
4. Verified both light (default) and dark themes show the editorial flat style.
