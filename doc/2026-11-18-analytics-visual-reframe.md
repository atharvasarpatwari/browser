# Analytics Dashboard — Visual Reframe

**Date:** 2026-11-18
**Session:** Visual reframe of `doc/analytics.html` (on branch `claude/analytics-editorial-restyle`, PR #11)
**Status:** Completed

---

## Summary
Reframed the dashboard's visual layout on top of the existing editorial theme: the centered glowing logo block became a left-aligned editorial masthead (eyebrow → display wordmark → separated dateline → rule), and the KPI cards were reframed as left-aligned, color-capped tiles. Section order and data are unchanged — appearance only.

## Changes
### 1. Editorial masthead
**File:** `doc/analytics.html` (appended CSS + one markup change)
- Hid the two base64 logo images and the dark gradient `.header-logo-wrap`.
- Promoted the previously `sr-only` `<h1>` to a visible `.masthead-title` (display font, `clamp(1.9rem,4vw,2.9rem)`, tight tracking).
- Left-aligned the header; kicker now reads as an eyebrow above the title.
- Reframed `.stat-line` into a dateline row: inline items with `border-left` separators and a top hairline.
- Added a 2px rule under the header to divide it from the nav.

### 2. Color-capped KPI cards
- Left-aligned card content; smaller, dimmer icon; tabular-figure values with tighter tracking; left-aligned uppercase labels.
- Each card gets a 3px top accent bar in its own color via `.kpi::after` + per-color `--kpi-accent` (cyan/purple/red/green/amber/blue/pink), reusing the existing value-color classes.

## Files Modified
| File | Change |
|------|--------|
| `doc/analytics.html` | Appended "Visual reframe" CSS block before `</style>`; `<h1 class="sr-only">` → `class="masthead-title">`; prepended this session's DOCS entry |
| `doc/README.md` | Added this change log to the Analytics index |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-11-18-analytics-visual-reframe.md` | This change log |

## Test Results
```
Verified live over HTTP (local static server, http://localhost:8791/analytics.html):
- Page renders; all KPIs animate from DOCS (365 / 11,248 / 864 / 2,316 / ~78%).
- Masthead, dateline separators, and per-color KPI caps render correctly in BOTH dark and light themes.
- No new console errors from the reframe. (Pre-existing, unrelated: analytics-churn.js 404 —
  that file is on origin/main but not tracked on this branch.)
```

## Verification Steps
1. Applied CSS/markup change, served `doc/` over HTTP (file:// can't run the dashboard JS).
2. Screenshot + `read_console_messages` in dark mode, then toggled to light mode and re-checked.
3. Confirmed section order and data unchanged; only header and KPI framing differ.
