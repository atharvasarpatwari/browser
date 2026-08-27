# Known Test Failures — Tracking

**Status:** Template only — needs a real `npm test` run to populate. Added 2026-08-27 by a
session that had file-bridge access to this repo but no shell/npm access, so it could read the
*pattern* of what's been reported across dozens of session logs but couldn't run the suite
itself to get current, specific failures. Whoever picks this up next: run `npm test`, then fill
in the table below and delete this status note.

---

## Why this file exists

Searching `doc/README.md`'s session index turns up this phrase, or a close variant of it,
repeatedly across many months of sessions:

> "...only pre-existing networking failures remain"
> "...3 pre-existing DNS failures only"
> "...tsc 5 known only"

Each individual session treated these as acceptable and moved on — reasonably, if the failures
are genuinely unrelated to what that session touched. But because no session has ever named
the specific failing tests in one place, there's no way to tell whether it's been the *same*
handful of failures the whole time, or a slowly growing set that each session assumed was the
same "pre-existing" ones without checking.

## What to do

1. Run the full suite: `npm test` (vitest) and `npm run typecheck` (tsc).
2. For every failure, record it below with the exact test file + test name, not just a count.
3. For each one, either:
   - Fix it, and remove the row, or
   - Confirm it's a genuinely known/accepted gap (e.g. a DNS test that needs real network
     access unavailable in the CI sandbox) and write *why* in the Notes column, so the next
     session doesn't have to re-investigate from scratch.

## Failures

| Test file | Test name | First seen | Notes |
|-----------|-----------|-------------|-------|
| _(run `npm test` and fill in)_ | | | |

## TypeScript errors

| File | Error | Notes |
|------|-------|-------|
| _(run `npm run typecheck` and fill in)_ | | |
