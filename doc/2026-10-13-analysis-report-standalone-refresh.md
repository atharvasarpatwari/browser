# Analysis Report Standalone Refresh

**Date:** 2026-10-13
**Session:** Refreshed the embedded data snapshot in `analysis-report/analysis-report-standalone.html` from the live git backend (55 → 90 commits), fixing a branch-name parsing bug uncovered along the way.
**Status:** Completed

---

## Summary
Regenerated the `EMBEDDED_DATA` snapshot inside `analysis-report/analysis-report-standalone.html` by starting the Express backend on :4567, fetching all 4 API endpoints, and re-injecting the JSON. Snapshot was frozen at 55 commits / 2026-08-24; now reflects the repo through the 2026-10-13 branch-integration merge commit (`502ca63`, 90 commits on `claude/integrate-codes-browser-6e8566`).

## Data Delta
| Field | Before (2026-08-24 snapshot) | After |
|-------|-------------------------------|-------|
| `stats.totalCommits` | 55 | 90 |
| `stats.currentBranch` | main | claude/integrate-codes-browser-6e8566 |
| `stats.openBranches` | 2 | 31 |
| `stats.totalFiles` | 1,105 | 1,127 |
| `stats.estimatedTests` | 2,317 | 2,200 |
| `stats.testFiles` | 216 | 225 |
| `commits[]` length | 55 | 88 (API caps at `limit=500`, actual total 90 minus 2 filtered) |

## Root Causes (problem → fix)

### 1. `git branch -a` worktree marker leaked into branch names
**File:** `analysis-report/backend/git-service.js`
**Problem:** `getBranchInfo()` parsed `git branch -a` output with `.replace(/^\*\s*/, '')`, which only strips the `*` current-branch marker. This repo now has many linked git worktrees (it had none when the 2026-08-24 snapshot was taken), and `git branch -a` prefixes any branch checked out in another worktree with `+ ` instead of a plain name. The first fetch of `/api/branches` during this refresh came back with literal `"+ claude/browser-new-tab-system-fd610e"` etc. in the array — a real, user-visible bug in the "All Branches" filter dropdown, not a formatting choice.
**Fix:** Widened the strip regex to `.replace(/^[*+]\s*/, '')`, matching both markers `git branch -a` can emit. Restarted the backend (a stale Windows node process was still holding :4567 after the first `pkill`, caught via `netstat`/`EADDRINUSE` before trusting the re-fetch) and re-fetched `/api/branches` to confirm clean names.

```js
// analysis-report/backend/git-service.js — before
const branches = all.split('\n').filter(Boolean).map(b => b.trim().replace(/^\*\s*/, ''));
// after
const branches = all.split('\n').filter(Boolean).map(b => b.trim().replace(/^[*+]\s*/, ''));
```

## Files Modified
| File | Change |
|------|--------|
| `analysis-report/backend/git-service.js` | Fixed `getBranchInfo()` to strip both `*` and `+` `git branch -a` markers |
| `analysis-report/analysis-report-standalone.html` | `EMBEDDED_DATA` refreshed (90 commits, clean branch list), fetch-timestamp comment updated |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-10-13-analysis-report-standalone-refresh.md` | This change log |
| (scratchpad) `rebuild-standalone.js` | Fetches `/api/stats`, `/api/branches`, `/api/activity?days=30`, `/api/commits?limit=500`, injects JSON via a balanced-brace scan (avoids the duplicate-closing-brace bug from the 2026-08-24 refresh's naive `indexOf('};')` splice) |

## Test Results
```
node rebuild-standalone.js → INJECTED OK
  stats.totalCommits = 90   currentBranch = claude/integrate-codes-browser-6e8566   todayCommits = 0
  branches = [...31 clean names, no leading "+ "...]
  activity days = 30 (total 14 commits)
  commits = 88 / total 88

node --check <extracted inline script> → SCRIPT SYNTAX OK
git diff --stat → 2 files changed, 3 insertions(+), 3 deletions(-)
```

## Verification Steps
1. Installed backend deps (`npm install` in `analysis-report/backend`, none were present).
2. Started the backend (port 4567) and fetched all 4 endpoints; noticed the `+ ` prefix bug in `/api/branches` output before injecting anything.
3. Fixed `git-service.js`, killed the stale server process (first `pkill` missed the Windows-spawned node process; found and killed it directly via `netstat`/`taskkill` after `EADDRINUSE`), restarted, and re-fetched confirming clean branch names.
4. Re-ran the injection against a clean backup of the original file (balanced-brace scan, not a fragile `indexOf`), confirmed `node --check` on the extracted inline script.
5. Opened the page in a browser, confirmed stat tiles (90 commits, 31 branches, current branch, repo size), the Daily Commit Activity chart, and the commit table all render real, current data; checked console for errors (none).
6. `git diff --stat` scope confirmed: only the two intended files changed.
7. Backend stopped after capture.

## Notes
- The standalone file remains a live mirror: when the backend on :4567 is running, the page fetches fresh data; `EMBEDDED_DATA` is the offline fallback.
- Next refresh can reuse the same balanced-brace injection approach; it's immune to the duplicate-brace failure mode documented in the 2026-08-24 refresh.
