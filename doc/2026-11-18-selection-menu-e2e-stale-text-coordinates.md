# Selection Right-Click E2E: Stale Text Coordinates After the Engine's Margin Fixes

**Date:** 2026-11-18
**Session:** Root-cause the failing Electron test "text on a rendered page can be selected, copied, and searched from the right-click menu"
**Status:** Completed

---

## Summary

The test was wrong, not the app. Its hard-coded page point `TEXT_AT = { x: 40, y: 452 }` was measured on 2026-10-06, against an engine that ignored the `/select` page's inline `margin:0`. When the engine started honouring inline shorthands (Nova Android 1.13 + 1.14, `8c3c568`) and later collapsed the h1's margin with the body's (1.74, `e1ef2c4`), the line of text moved 40 px up. The right-click at y 452 then landed 22–31 px below the text. `TEXT_AT`/`PAST_TEXT_END` now use y 405, inside the line box CSS 2.2 gives (381–429). No app code changed.

## Root Causes

### 1. The test's text coordinate came from a layout that dropped inline `margin:0`
**File:** `tests/e2e/helpers/electron-app.ts`
**Problem:** the `/select` page is `<h1>Select me</h1><div style="height:300px">spacer</div><p style="font-size:32px;line-height:48px;margin:0">Alpha … hotel</p>`. Before `8c3c568`, inline `style=""` shorthands were not expanded, so `margin:0` was lost and the `<p>` kept its UA 1em (32 px) top margin. Parent and first-child margins also didn't collapse, which added the body's 8 px above the h1. `TEXT_AT.y = 452` sat inside that misplaced line. After the two engine fixes, the line box is where CSS 2.2 puts it:

- h1 top margin 21.44 px collapses with body 8 px → h1 at 21.44, 38.4 px tall, bottom margin 21.44
- spacer 300 px → `<p>` line box at y 381.28–429.28, text from x 8 (body margin)

The test's first two gestures still passed. `PageSelection.caretAt` snaps to the *nearest* line, so a double-click or drag 30 px under the text still selects it. Only the right-click checks the point exactly (`PageSelection.contains`, via `SearchIntegration.selectionAt`), and that is correct behaviour: a right-click below the selected line is not on it. So the plain page menu opened just under the text.

**Fix:**
```ts
/**
 * On the first word ("Alpha") of the `/select` page's line of text; a point far to the right of that line is past its end.
 * CSS 2.2: the h1's 21.44 px top margin collapses with the body's 8 px, the h1 is 38.4 px tall plus a 21.44 px bottom
 * margin, then the 300 px spacer, so the 48 px line box is y 381–429 (text from x 8, after the body margin).
 */
const TEXT_AT = { x: 40, y: 405 };        // was y 452
const PAST_TEXT_END = { x: 1800, y: 405 }; // was y 452
```

### Evidence

Logged in `PageSelectionController.containsClientPoint` for the right-click. The point maps identically on both builds, but the selection rects moved:

| Build | `toPage` result | Selection rects (x, y range) | `contains` |
|---|---|---|---|
| `main` 8736805 (old engine) | (99.6, 450.7) | x 0…, y 430.88–469.28 | true → passes |
| `c161739` (failing) | (99.6, 450.7) | x 8…, y 390.88–429.28 | false → page menu |

The painted pixels agree with the model, so this is not a paint-vs-geometry mismatch. Ink of the `/select` line, read from the page canvas at each commit:

| Commit | Line ink rows | Change |
|---|---|---|
| `1aab0f7` (1.12, last good) | 431–462 | y 452 inside |
| `8c3c568` (1.13 + 1.14, first bad) | 399–430 | −32 px: inline `margin:0` honoured |
| `e1ef2c4~1` | 401–429 | glyph metrics |
| `e1ef2c4` (1.74) | 393–421 | −8 px: h1/body top margins collapse |
| `c161739` | 393–421 (x from 8) | unchanged since 1.74 |

`git bisect` between `b71d14c` (good) and `c161739` (bad). It only counted a commit bad when the right-click "Copy" step failed. It named `8c3c568` as the first bad commit. This also explains why the three candidates bisected earlier made no difference (the archive-indexing default, the 0.05 vs 0.4 restyle threshold, the real `NewTabPage` at startup): none of them touch layout.

## Files Modified
| File | Change |
|------|--------|
| `tests/e2e/helpers/electron-app.ts` | `TEXT_AT`/`PAST_TEXT_END` y 452 → 405, with the CSS 2.2 derivation in the comment |
| `doc/README.md` | Change Logs row for this doc |
| `doc/analytics.html` | `DOCS` entry; header/KPI fallback numbers and generated stamp resynced |

## Files Created
| File | Purpose |
|------|--------|
| `doc/2026-11-18-selection-menu-e2e-stale-text-coordinates.md` | This change log |

## Test Results

Branch `claude/selection-menu-fix` at `c161739` (the failing code), after `npm run build:web`:

```
npx playwright test --config=playwright-electron.config.cjs tests/e2e/search-electron.spec.ts -g "text on a rendered page can be selected"
  ok 1 tests\e2e\search-electron.spec.ts:263:1 › text on a rendered page can be selected, copied, and searched from the right-click menu (4.8s)
  1 passed (6.5s)

npx playwright test --config=playwright-electron.config.cjs tests/e2e/search-electron.spec.ts
  15 passed (1.4m)

npx vitest run
 Test Files  1 failed | 350 passed (351)
      Tests  1 failed | 11525 passed (11526)
 FAIL  tests/mdn-icons-percent-heights-183.test.ts > MDN "HTML" reference (saved 2026) > has no bars over the article and no ballooned header toggle
 TypeError: Cannot read properties of null (reading 'height')   (no <mdn-toggle-sidebar> found in the parsed fixture)
```

Before the fix, the same targeted run failed at `menu.getByText('Copy', { exact: true })` (element not found).

The one vitest failure is pre-existing on `c161739` and unrelated. It also fails when run alone (`npx vitest run tests/mdn-icons-percent-heights-183.test.ts`: 10 passed, 1 failed). The fixture `tests/fixtures/mdn-html-2026/` is present, and this branch's `src/` is exactly `c161739`'s; vitest does not import the e2e helper changed here.

## Verification Steps

1. Reproduced: the test passed 3/3 on `main` (8736805) and failed on `c161739`, the commit where the reported bisect candidates live.
2. Logged `toPage` and the selection rects for the right-click (table above). The point was the same and the text was 40 px higher.
3. Read the page canvas's ink rows to confirm the paint matches the selection model.
4. Bisected with a throwaway worktree. Its `node_modules` junction was unlinked with `rmdir` before `git worktree remove`.
5. Re-ran the targeted test, the full Electron search spec and `npx vitest run` with the new coordinates.

**Note:** don't take this change to `main` on its own. `main` still lays the line out at y 431–469 (the old engine), so y 405 fails there. The change belongs with the engine work (branch `claude/ecstatic-fermi-f08bd5`, the base of `claude/selection-menu-fix`).
