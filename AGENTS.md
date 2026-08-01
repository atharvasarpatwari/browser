# AGENTS.md — Project Instructions for Nova Browser

## Mandatory Documentation Rule

**Every session that modifies source code MUST produce a change log document in `doc/` before the session ends.**

### Requirements

1. **File location:** `E:\nova_1\doc\YYYY-MM-DD-<short-description>.md`
2. **Naming:** Use today's date and a hyphenated slug (e.g., `2026-07-18-script-execution-fixes.md`)
3. **Content must include:**
   - Summary of all changes made
   - Root causes for any bugs fixed (problem → fix with code snippets)
   - List of all files modified and created
   - Test results (pass/fail counts)
   - Verification steps taken
4. **Plans and RFCs** also go in `doc/` with descriptive names (e.g., `resource-prioritization-plan.md`)
5. **Update `doc/README.md`** to index any new documents added

### When to Write Docs

| Trigger | Action |
|---------|--------|
| Bug fix session | Write change log with root cause analysis |
| Feature implementation | Write change log with architecture decisions |
| Design/planning session | Write plan document with scope and decisions |
| Refactoring session | Write change log with before/after comparisons |
| Test additions | Include in the relevant change log |

### Doc Template

```markdown
# <Title>

**Date:** YYYY-MM-DD
**Session:** <brief description>
**Status:** Completed | In Progress | Planned

---

## Summary
<1-2 sentence overview>

## Root Causes (if bug fix)
### 1. <Cause name>
**File:** <path>
**Problem:** <what was wrong>
**Fix:** <what was changed, with code>

## Files Modified
| File | Change |
|------|--------|

## Files Created
| File | Purpose |
|------|--------|

## Test Results
```
<test output>
```
```

### Enforcement

At the end of every prompt delivery, the agent MUST:
1. Check if any source files were modified or created
2. If yes, generate the doc file before marking the task complete
3. Update `doc/README.md` index if a new doc was created

## Run & Verify Rule

**Every piece of code written or modified MUST be run/verified before the task is marked complete. If it fails, rewrite it until it runs properly.**

- After writing or editing code, run it (e.g. `npx tsc --noEmit`, `npx vitest run <file>`, `node <script>`, build command) and confirm success.
- If the run fails, fix the code and re-run — do not declare success without a passing run.
- Log the exact command run and its output in the session's change log (Test Results section).

## Token Efficiency Rule

**Do NOT read source code files for reference/context. Use `doc/` files instead.**

- `doc/README.md` indexes all sessions with summaries
- Individual `doc/YYYY-MM-DD-*.md` files contain file lists, architecture decisions, root causes, and test results
- Source files should ONLY be read when actively editing them
- This avoids wasting tokens on large source files when the docs already contain the needed context
