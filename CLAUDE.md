# Nova Browser — project instructions

## Write a session changelog doc at the end of substantial work

At the end of any session that fixes bugs, ships a feature, or otherwise
changes real behavior (not trivial one-liners, not pure investigation with
no code change), write a changelog doc and register it in the analytics
dashboard:

1. Create `doc/YYYY-MM-DD-slug.md` using today's date and a short kebab-case
   slug. Follow the existing schema — see any recent `doc/*.md` for the
   exact shape: `**Date:**`/`**Session:**`/`**Status:**` header, then
   `## Summary`, `## Root Causes` (numbered, one per distinct bug — not one
   per commit if several commits share one root cause, and vice versa),
   `## Notes`, `## Files Modified` (table), `## Files Created`, `## Test
   Results`, `## Verification Steps`.
2. Add one entry to the `DOCS` array in `doc/analytics.html`
   (`{file, date, title, category, tests, status, rootCauses,
   filesModified, filesCreated}`) for the new doc. `tests` is the *net new*
   test case count (check with `git diff` on touched test files, not the
   full-suite delta, which can be muddied by unrelated flakes).
3. Resync the hardcoded header/KPI fallback numbers in `analytics.html`
   (`statDocs`, `statDays`, `statTests`, `statGenerated`, `kpiDocs`,
   `kpiTests`, `kpiRootCauses`, `kpiFiles`) to match the recomputed `DOCS`
   totals — these are load-time fallbacks the page's own JS overwrites at
   runtime, but they drift if left stale and should never be guessed by
   hand. Recompute them, don't eyeball them.
4. Verify before considering this done: extract the `DOCS` array with
   Node and confirm (a) zero duplicate `file` values, (b) every `.md` in
   `doc/` (except `README.md`) has exactly one entry and vice versa —
   `doc/analytics.html`'s dashboard is only trustworthy if every entry
   points at a real file and every file has an entry, (c) `node --check`
   on the extracted inline `<script>`.

Skip this for pure refactors with no behavior change, doc-only edits, or
sessions where nothing shipped.

## Worktree sessions cannot touch the main checkout

If you are running in a git worktree under `.claude/worktrees/`, the Edit
and Write tools refuse to touch files in the primary checkout (`E:\nova_1`
directly) — by design, since those tools can't record the change against
this session's branch, and the main checkout may have its own uncommitted
state. `git worktree list` will still show the main checkout, but
`EnterWorktree` cannot switch into it either (it errors "the main working
tree, not a linked worktree").

This means `doc/` changes above may need to happen from a session actually
rooted at `E:\nova_1` (not a worktree), or be handed off as a small,
dry-run-verified Node script the user runs themselves — do not use Bash to
route around the Edit/Write refusal for the same file it just refused; that
defeats the point of the guardrail. A worktree's own copy of `doc/` can
also be stale relative to `main` (new commits on `main` after the worktree
branched won't appear there) — diff the two before assuming they match.
