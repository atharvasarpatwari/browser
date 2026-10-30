# Analytics Dashboard — Code Churn Section (lines changed per day)

**Date:** 2026-10-30
**Session:** "make some changes in this code where i can see the number of lines changed in the files day by day" — add a per-day line-churn view to `doc/analytics.html`, with the data stored in `doc/`.
**Status:** Completed

---

## Summary

`doc/analytics.html` had no real code numbers in it: every chart is derived from the `DOCS` metadata array (tests, root causes, files touched), and the Changelog section's per-day figures come from the same place — nothing in the page knew how many lines were actually written on a given day.

Added a **Code Churn** section fed by a new generated dataset, `doc/analytics-churn.js`, which is produced from `git log --numstat` by `doc/gen-analytics-churn.mjs`. The section shows six headline numbers, an added-vs-removed bar chart per day (14d / 30d / all), and a full table of every active day.

## What was added

### `doc/gen-analytics-churn.mjs` (new)
Runs `git log --all --no-merges --numstat --date=short`, groups by author date and writes `doc/analytics-churn.js`:

```js
window.CODE_CHURN = {
  generated: "2026-10-30 04:26",
  days: [
    {"date":"2026-07-08","commits":3,"files":41,"added":12104,"removed":0,"net":12104,"authors":["Atharva Sarpatwari"]},
    ...
  ]
};
```

- `--all`, because most of the work lands on `claude/*` branches that were never merged into `main` — with plain `git log` the data stopped at 2026-10-21 and lost 22 days.
- Binary files (`-`/`-` in numstat) are skipped, and renames (`{old => new}`) count against the new path.
- Generated and vendored paths are excluded, so a rebuilt web bundle cannot swamp a day with lines nobody wrote: `node_modules/`, `dist|build|out/`, `android/app/src/main/assets/`, `package-lock.json`, `*.min.js|css`, `*.map`.

Re-run it any time with `node doc/gen-analytics-churn.mjs`.

### `doc/analytics.html` (modified)
- `<script src="analytics-churn.js">` next to the existing Chart.js tag, so it also works when the file is opened directly.
- A `Churn` nav pill between Activity and Categories.
- A `#churn` section (reusing the existing `leader-section glass` / `leader-table` / `metric-toggle` styles, plus six small rules for the stat row and canvas height) with:
  - stat row: lines added, lines removed, net lines, active days, average changed per day, busiest day;
  - a stacked bar chart — added above the axis, removed below — with 14D / 30D / ALL buttons;
  - a table of every day: date, commits, files, added, removed, net (newest first).
- A self-contained renderer appended to the page script; if `analytics-churn.js` is missing the section hides itself instead of throwing.

## Current numbers

| Metric | Value |
|--------|-------|
| Active days | 77 (2026-07-08 → 2026-10-30) |
| Lines added | 459,707 |
| Lines removed | 90,913 |
| Net | +368,794 |
| Average changed per day | 7,151 |
| Busiest day | 2026-07-19 (52,843 lines) |

## Files Modified
| File | Change |
|------|--------|
| `doc/analytics.html` | churn dataset script tag, nav pill, `#churn` section, CSS for the stat row/canvas, renderer |

## Files Created
| File | Purpose |
|------|---------|
| `doc/gen-analytics-churn.mjs` | regenerates the dataset from git |
| `doc/analytics-churn.js` | generated per-day churn dataset read by the dashboard |
| `doc/2026-10-30-analytics-code-churn-section.md` | This change log |

## Test Results

```
node doc/gen-analytics-churn.mjs
  -> E:\nova_1\doc\analytics-churn.js: 77 days, +459707 / -90913 lines

served doc/ on localhost and loaded analytics.html in a browser:
  console errors                    -> none
  window.CODE_CHURN.days.length     -> 77
  #churnBody rows                   -> 77
  Chart.getChart('churnChart')      -> present, 30 bars by default
  ALL toggle                        -> 77 bars (07/08 → 10/30)
  14D toggle                        -> 14 bars, button state correct
```

## Notes
- The nightly to-do task already regenerates `doc/analytics-todos.js`; wiring `gen-analytics-churn.mjs` into the same schedule would keep the churn numbers current without a manual run. Not done here.
- Numbers count commits by author date across all branches, so a day on which the same change was cherry-picked to two branches counts once per distinct commit.

## Refresh pass (2026-10-30 10:12)

Re-ran the generator so the section covers the commits that landed since the first pass (1.37-1.43 work; today's row is 4 commits, +1,188 / -223). Totals are unchanged at 77 active days because those commits were already in the earlier run's window.

Two small fixes while refreshing:

- the `Auto-generated` stamp used `toISOString()`, i.e. UTC, which read 04:41 while the clock said 10:11; it is local time now, matching the dashboard's own stamps;
- the section shows a one-line provenance note under the stats — source, when the data was generated, and the command to refresh it — so a stale dataset is visible instead of silent.

Verified again in a browser: no console errors, `generated` 2026-10-30 10:12, 77 days, 77 table rows, today's row present.

---

## Quietest-day stat (2026-10-30 later)

The stat row showed only the high end (`Busiest day`). Added the matching low end so both
extremes of per-day churn are on the page:

```js
const changed = (d) => d.added + d.removed;
const busiest  = data.reduce((a,d) => changed(d) > changed(a) ? d : a, data[0]);
const quietest = data.reduce((a,d) => changed(d) < changed(a) ? d : a, data[0]);
```

`doc/analytics.html` only — one extra `stat(...)` tile, no markup or CSS changes.

| Extreme | Day | Lines changed |
|---------|-----|---------------|
| Busiest | 2026-07-19 | 52,843 (+50,937 / -1,906 — the engine import) |
| Quietest | 2026-09-26 | 268 (+214 / -54) |

Other per-column extremes, for reference (not shown on the page — the table already has them):
most added 2026-07-19 (+50,937), most removed 2026-10-12 (-20,472), most commits 2026-09-12 (22),
most files 2026-07-28 (964).

### Test Results

```
served doc/ on localhost, loaded analytics.html:
  console errors                 -> none
  #churnStats readout            -> "+459,707 | LINES ADDED | -90,913 | LINES REMOVED |
                                     368,794 | NET LINES | 77 | ACTIVE DAYS |
                                     7,151 | AVG CHANGED/DAY |
                                     2026-07-19 | BUSIEST DAY (52,843) |
                                     2026-09-26 | QUIETEST DAY (268)"
  values cross-checked against analytics-churn.js min/max -> match
```
