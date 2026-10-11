# Omnibox Polish — Query-Type Badge and Hover Actions on Dropdown Rows

**Date:** 2026-10-04
**Session:** First of three follow-ups to the search subsystem (omnibox polish → engine auto-discovery → performance gates), picked by the user after the three-session merge (`9d81723`)
**Status:** Completed — covered by tests and verified in the running app (see Verification)

---

## Summary

Two items from §4 of the search-engine plan (`2026-10-02-highest-search-engine-implementation-plan.md`) that the omnibox lacked:

1. **Query-type badge.** While you type, a small badge in front of the input says what Enter is going to do with the text — `🌐` go to an address, an accent pill `!w` / `@tabs` for a bang or scope (tooltip: "Search Wikipedia"), `✨` ask Nova AI, `⚡` run a browser command, `🧮` instant answer, `🔍` plain search. It stands in for the lock icon while it shows and disappears on submit, Escape, blur or empty input. Nothing shows while an `@scope` is still half-typed.
2. **Hover actions on dropdown rows.** Rows that stand for a page (history, bookmark, open tab, URL, archive) get a **⧉ copy link** button; history rows also get **✕ remove from history**. The buttons appear on hover and on the highlighted row; `Shift+Delete` removes the highlighted history row from the keyboard (the Chrome convention). Removing re-runs the query, so the row disappears from the open dropdown.

`Alt+Enter` (new tab) and `Esc` (restore) from the same plan section were already done.

## Design

- **Badge is derived where the classification already happens.** `OmniboxController.update()` already runs `classifyQuery`; `badgeFor(c)` maps the `ClassifiedQuery` to a `QueryBadge { kind, text, title }` and hands it to `OmniboxViewPort.setQueryBadge?()` (optional, so older view ports keep working). The bang's engine name comes from `bangs.get(c.bang)`, so engines the user added in Settings are named correctly.
- **The view clears its own badge on blur.** Enter, Escape and choosing a row all end in an input blur, so `blur` is the single place that clears it (not `hideSuggestions()`, which also runs when a query simply has no results — `@tabs zzz` must keep its `@tabs` badge). The controller additionally clears it on submit/activate/empty input.
- **Buttons are not rows.** Rows activate on `mousedown` (so the input's blur cannot hide them first). The buttons therefore swallow `mousedown` (`preventDefault` keeps focus in the input, `stopPropagation` keeps the row from activating) and act on `click`.
- **"Copy link" only on rows that stand for a page.** A `search` row's URL is a generated query (`nova://search?q=…`), which nobody wants on the clipboard. The copy button flips to `✓` ("Copied") after use.
- **Removal goes through the host.** `history-suggestions.ts` rows now carry `meta.historyId` (`tiered()` already preserves `meta`); the view calls a `RowActionHandler`; the controller calls `OmniboxActions.deleteHistory(id)` → `SearchHost.deleteHistoryEntry(id)` → `BrowserWindowPage.removeHistoryEntryExternal(id)` → `historyService.deleteEntry(id)`. The controller awaits the deletion **before** re-querying (otherwise the deleted row would come straight back), and does not re-query when Enter already ended the typing (the dropdown must not reopen over the page — the existing `suppress` guard).

## Root Causes (defects found while building it)

### 1. Shift+Delete left the removed row's preview in the input
**File:** `src/ui/components/address-bar/address-bar.view.ts`
**Problem:** Arrowing onto a row previews its URL in the input. After `Shift+Delete` the dropdown re-rendered and dropped the highlight, but the input still showed the URL of the row that had just been removed — text the user never typed. Found in the live run; the unit tests had checked the row list but not the input.
**Fix:** restore the typed text before handing the removal off:
```ts
if (e.shiftKey && selected && isDeletable(selected)) {
  e.preventDefault();
  input.value = this.typedValue; // the removed row's preview must not linger in the input
  this.rowActionHandler?.('delete', selected);
}
```
Regression tests in `tests/address-bar-omnibox.test.ts` and `tests/search-integration.test.ts` (both fail without the line).

## Files Modified

| File | Change |
|------|--------|
| `src/ui/components/address-bar/address-bar.view.ts` | `QueryBadge`, `RowAction`/`RowActionHandler` types; `.nova-addressbar-badge` element + `setQueryBadge()` (clears on blur); `setRowActionHandler()`; hover buttons in `buildRow()` (`buildRowActions`); `Shift+Delete`; `COPYABLE_TYPES`/`isDeletable` |
| `src/ui/components/omnibox-controller.ts` | optional `setQueryBadge`/`setRowActionHandler` on `OmniboxViewPort`; `badgeFor()`; `rowAction()` (copy, delete-then-refresh with the `suppress` guard); `OmniboxActions.deleteHistory` |
| `src/browser/omnibox/history-suggestions.ts` | history rows carry `meta.historyId` |
| `src/ui/pages/search-integration.ts` | `SearchHost.deleteHistoryEntry`; `deleteHistory` in the omnibox actions |
| `src/ui/pages/browser-window.ts` | host supplies `deleteHistoryEntry` (→ `removeHistoryEntryExternal`) |
| `styles.css` | badge/pill styles (section 09), row action buttons (section 27) |
| `tests/address-bar-omnibox.test.ts` | +13 (badge element/API; buttons by row type; click vs press; copy check; `Shift+Delete`) |
| `tests/omnibox-controller.test.ts` | +18 (badge per intent/edge cases; copy; delete-then-refresh ordering; failure; suppress guard) |
| `tests/search-integration.test.ts` | +18 (badge end to end through the real address bar; row actions against a fake history; in-flight removal vs Enter); fake host gained `history` entries and `deleteHistoryEntry` |
| `tests/omnibox.test.ts` | +1 (history rows carry their id) |
| `tests/search-subsystem.test.ts` | fake actions gained `deleteHistory` |

## Files Created

| File | Purpose |
|------|---------|
| `doc/2026-10-04-omnibox-polish.md` | this change log |

## Test Results

```
$ npx tsc --noEmit
(no output, exit 0 — 0 errors)

$ npx vitest run tests/address-bar-omnibox.test.ts tests/search-integration.test.ts tests/omnibox-controller.test.ts tests/search-subsystem.test.ts tests/omnibox.test.ts
 Test Files  5 passed (5)
      Tests  263 passed (263)

$ npx vitest run            (full suite)
 Test Files  1 failed | 247 passed (248)
      Tests  3 failed | 10082 passed (10085)
   Duration  185.22s
```

The suite grew from 10,035 to 10,085 tests (+50 new: address-bar view 13, controller 18, integration 18, history provider 1). The 3 failures are the known environmental ones — `tests/networking-integration.test.ts › DnsResolver - real system resolution` (3 tests: the real resolver's `localhost` lookup times out after 5 s on this machine; they fail alone and on the unmodified commit too) — and nothing in this change touches networking.

## Verification

- **Mutation checks** (revert the change, the new tests must fail, then restore): removing the `!this.suppress` guard fails the controller and integration "does not re-open the dropdown" tests; removing the blur-clear fails 2 badge tests; removing `stopPropagation` on the buttons' `mousedown` fails 2 press-isolation tests; removing the typed-text restore fails the 2 `Shift+Delete` tests.
- **Live, in the running app** (Vite dev server, the app in a 1280×720 iframe in the Browser pane): typing `hello world`, `example.com`, `!w cats`, `@tabs inbox`, `@ai how do tides work`, `open settings`, `2+2` showed 🔍 / 🌐 / `!w` ("Search Wikipedia") / `@tabs` / ✨ / ⚡ / 🧮; `@ta` and empty input showed none and the lock icon came back. Hovering a history row showed ⧉ and ✕. A **real mouse click** on ✕ (event log: `pointerdown/mousedown/mouseup/click` all on the button, no `blur`) removed the entry, kept the input focused and the dropdown open; ⧉ asked the clipboard to write `https://example.com/` and flipped to ✓; `Shift+Delete` removed the highlighted row, plain `Delete` was left alone.
- **Live-testing notes** (not product bugs): the Browser pane scales screenshot coordinates (265 → 280 px), and `input.focus()` re-scrolls the outer page, so clicks must be aimed from the element's real rect; the first two attempts landed on the row and rightly navigated.
