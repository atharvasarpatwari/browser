# Nightly Tomorrow To-Dos (22:00 Scheduled Task)

**Date:** 2026-10-17
**Session:** Auto-generate tomorrow's work every night at 22:00 from past session data
**Status:** Completed

---

## Summary
A local Claude scheduled task (`nova-tomorrow-todos`, cron `0 22 * * *`) reads past session data each night. That data is the `DOCS` array in `analytics.html`, recent `doc/*.md` files, and `git log`/`git status`. The task writes 3–7 tasks for the next day to `doc/analytics-todos.js`. `analytics.html` loads that file and merges the tasks into "Tomorrow's To-Do List".

## Design
The to-do list is stored in the browser's `localStorage`, which a scheduled task can't write to. To get around this:
- The task writes `doc/analytics-todos.js`, which contains `window.AUTO_TODOS = [{key, text, priority}]`.
- `analytics.html` loads it with `<script src="analytics-todos.js">`. If the file is missing, `window.AUTO_TODOS` is undefined and nothing happens.
- `mergeAutoTodos()` adds each `key` only once and records merged keys in `localStorage` under `nova_analytics_todos_v1_auto_seen` (capped at 500). A task you tick or delete stays gone.

```js
function mergeAutoTodos(){
  const auto=window.AUTO_TODOS||[];
  ...
    if(!t.key||!t.text||seen.includes(t.key))continue;
    todos.push({id:todoIdSeq++,text:t.text,image:null,done:false,priority:t.priority||'medium'});
```

## Files Modified
| File | Change |
|------|--------|
| doc/analytics.html | Load `analytics-todos.js`; add `mergeAutoTodos()` before `renderTodos()`; add a DOCS entry for this doc |
| doc/README.md | Index entry |

## Files Created
| File | Purpose |
|------|--------|
| doc/2026-10-17-nightly-tomorrow-todos.md | This change log |
| doc/analytics-todos.js | Nightly feed, written by the scheduled task in `E:\nova_1\doc\` (not committed) |
| C:\Users\athar\.claude\scheduled-tasks\nova-tomorrow-todos\SKILL.md | Scheduled task prompt (outside the repo) |

## Test Results
```
node (fake localStorage): merge 2 tasks -> 2; delete one, re-merge -> 1 (not re-added); AUTO_TODOS undefined -> no-op
ok 1
node: DOCS array evals -> 264 entries, last = 2026-10-17-nightly-tomorrow-todos.md

Manual run of nova-tomorrow-todos (2026-10-17 23:29): wrote 7 tasks for 2026-10-18 (2 high, 3 medium, 2 low)
Browser (http://localhost:8765/analytics.html via .claude/launch.json "doc-analytics"):
  AUTO_TODOS=7, todoTotalCount=7; deleted 1 + reload -> 6 (not re-added)
Schedule: cron 0 22 * * *, nextRunAt 2026-10-18T16:41Z (22:11 local incl. jitter)
```

## Review of the first run (feed rewritten, prompt tightened)
I checked the 7 tasks from the first run against their source docs (branch `claude/ecstatic-fermi-f08bd5`, not merged to main) and against later commits:

| First-run task | Verdict | Evidence |
|---|---|---|
| Re-check pull-to-refresh / find-in-page on phone | **Real** | ui-features doc: "re-check pending", find "not yet driven on device" |
| Verify download dedupe + http→https on device | **Real** | download-fixes doc: "Not run on a device" |
| Fix PNG decode in Electron | **Already fixed, needs re-test** | Fix `3930751` (pngjs under contextIsolation) wasn't an ancestor of `7ee23ff` (when the bug was reported) and arrived via merge `7424677` |
| Sign R8 release APK + smoke test | **Done** | trim doc round 2: signed release APK, `apksigner verify` OK; ui-features: smoke test 8/8 on the phone |
| Run emulator test plan after AEHD | Blocked / optional | Waiting on the user's admin driver install; a real phone is used now |
| Swipe-to-close TabSwitcher | Optional | Doc: "swipe-to-close skipped, add if wanted" |
| Triage main's stray files | Housekeeping | Not a fix |
| *(missed)* Long-press double menu | **Real, added** | ui-features doc: desktop context menu + native sheet may both open; "Not yet checked on device" |

- `analytics-todos.js` was rewritten for 2026-10-18 with only the 4 real items, using new keys `2026-10-18-r1..r4` so they merge even where the old keys were already merged.
- The nightly prompt now:
  1. reads docs on recent unmerged branches via `git ls-tree`/`git show` (no `find`, which timed out);
  2. checks every candidate against later commits and merges (`git log --since`, `merge-base --is-ancestor`) and newer docs;
  3. drops done items and turns "fix landed, not re-tested" into a "Confirm X is fixed" task;
  4. always marks optional, housekeeping and blocked items **low** with an "(optional)"/"(blocked: …)" prefix, and leaves them out when there are already ≥ 4 high/medium items;
  5. reports what it dropped and why.

```
node feed check -> 4 tasks ok
Browser (localStorage cleared): todoTotalCount=4, the r1..r4 texts listed
```

## Verification
- Ran the scheduled task once manually to fill in the first feed. The task checks the feed itself with a `node` require + shape check.
- Scheduled tasks run only while the Claude app is open. A missed run happens the next time the app launches.
