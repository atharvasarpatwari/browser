# Tomorrow's To-Do Analysis (2026-10-28)

**Date:** 2026-10-27
**Session:** nova-tomorrow-todos scheduled run (22:00), analysis of the existing docs to pick tomorrow's work
**Status:** Completed

---

## Summary
Reviewed the DOCS index, the recent Android docs (1.26 to 1.33), and the git log since 2026-10-21. Seven tasks were kept for 2026-10-28 (4 high, 3 medium). Written to `doc/analytics-todos.js`. No source code was changed and nothing was committed.

## Method
- Read the `DOCS` array in `doc/analytics.html` and the index in `doc/README.md`.
- Listed the newest branches. The recent Android docs live in the working tree, and the `claude/ecstatic-fermi-f08bd5` branch carries the same 2026-10-27 docs.
- Grepped the 2026-10-16 to 2026-10-27 docs for open-item markers: pending, not verified, not run on a device, known remaining, not done.
- Checked each candidate against `git log --all --since=<doc date>` and the docs written after it.

## Tasks for 2026-10-28

| Priority | Task | Source doc | Evidence |
|---|---|---|---|
| high | Commit untracked `crypto-utils.ts`, `socket-owner.cjs`, `preload.cjs` so a clean `main` builds | 2026-10-18-android-long-press-double-menu | `git status` still shows the three files as `??` |
| high | Hit-test in paint order; a Wikipedia footer overhang steals taps on the button | 2026-10-20-nova-android-1.25 | "Known Remaining" in 1.24 and 1.25; no later fix in 1.26 to 1.33 |
| high | Fix Minerva's user menu placed ~400px above its parent | 2026-10-20-nova-android-1.23 | "Known Remaining" in 1.23, 1.24, 1.25; not mentioned in any later doc |
| high | Keep downloads across restarts; the downloads sheet is empty after a restart | 2026-10-21-android-feature-test-on-device | "Found not fixed"; no later commit touches downloads persistence |
| medium | On the phone: submit a POST form at httpbin.org/forms/post | 2026-10-27-nova-android-1.33-post-forms | Form submit pending; phone locked during the 1.33 run |
| medium | On the phone: confirm the 1.32 http:// fallback and tab restore, plus the 1.27 User-Agent and error pages | 2026-10-26-nova-android-1.32 (and 1.27) | Fixes landed; no device run recorded |
| medium | Confirm Google results paint on a live network after the 1.29 JS fixes (RC-2) | 2026-10-26-nova-android-1.29 | Challenge page now runs with 0 script errors; results page needs a network run |

Low-priority items were left out because there were already 4 or more high/medium tasks: async generators round 3 (planned in `2026-10-26-nova-js-async-generators-plan.md`), and file uploads for POST forms (needs the native picker).

## Candidates dropped or already fixed

| Candidate | Reason | Evidence |
|---|---|---|
| Search-performance timing gate flakes under full-suite load | Passed in the 1.33 full run | `2026-10-27-nova-android-1.33-post-forms.md`: 10,659 tests passed |
| http:// blocked silently (RC-4) | Fixed in 1.32; folded into the device check | `2026-10-26-nova-android-1.32-...` |
| Open tabs never saved (RC-9) | Fixed in 1.32; folded into the device check | same doc |
| POST forms do nothing (RC-12) | Fixed in 1.33; folded into the device check | `2026-10-27-nova-android-1.33-post-forms.md` |
| SVG logos garbled (RC-14) | 1.32 changed image scaling to area averaging; not confirmed on a device, so no separate task | `2026-10-26-nova-android-1.32-...` |
| Sheet "Cancel" cut off (RC-15), select overlay stays (RC-16) | Fixed in 1.28 | `2026-10-25-nova-android-1.28-...` |
| Dark mode ignored (RC-17) | Fixed in 1.32 | `2026-10-26-nova-android-1.32-...` |
| Link underlines and script error text (RC-18, RC-19) | Fixed in 1.28 | `2026-10-25-nova-android-1.28-...` |
| Slow Wikipedia results page (~15 s, from 1.24) | Not re-measured since 1.25 claimed a speed-up; left out to stay within 7 tasks | `2026-10-20-nova-android-1.24-...` |

## Files Modified
| File | Change |
|------|--------|
| `doc/analytics-todos.js` | Overwritten with the 7 tasks for 2026-10-28 |

## Files Created
| File | Purpose |
|------|--------|
| `doc/2026-10-27-tomorrow-todos-analysis.md` | This analysis: method, tasks, dropped candidates |

## Test Results
```
node -e "global.window={};require('E:/nova_1/doc/analytics-todos.js');..."
7 tasks ok
```
