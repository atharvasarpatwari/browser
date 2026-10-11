# Bookmark Import/Export (Phase 6d) — A Dedicated Parser Instead of the Engine's Own

**Date:** 2026-10-01
**Session:** Next Phase 6 "smaller polish" slice. Investigation compared this against a disk-backed HTTP cache and image-format gaps (AVIF/GIF animation/SVG rasterization); both turned out bigger than their one-line audit descriptions (the cache bundles unrelated correctness gaps — no-store/no-cache ignored, no ETag revalidation; AVIF/GIF have zero decode code at all, SVG rasterization is multi-piece new work). Bookmark import/export was the genuinely small, well-bounded one: `BookmarkService` has complete CRUD and zero import/export, and both directions (reading a file into the renderer, writing one back out) have direct, already-proven precedent in this codebase.
**Status:** Completed (1 root cause — a pre-existing, unrelated tree-builder bug, found and deliberately routed around, not fixed)

---

## Summary

Added real Netscape Bookmark File Format import/export: an Export button in the Bookmarks panel writes `bookmarks-YYYY-MM-DD.html` to the real OS Downloads folder (reusing `DownloadManager`'s exact `loadNodeBuiltin('node:fs')` + `window.nova.process.downloadsDir` write pattern), and an Import button reads a `.html` file via a hidden `<input type="file">` + `FileReader`-equivalent (`File.text()`), parses it, and recreates the structure under a new "Imported <date>" folder — matching real-browser convention (Chrome/Firefox both import into a fresh folder rather than attempting a name-matching merge).

The plan's original approach was to parse by reusing the engine's own `HtmlParser`/`DomTree` — "it's just HTML, reuse the real parser." That was tried first, and a diagnostic DOM-tree dump proved it unreliable: Nova's hand-rolled HTML5 tree-builder doesn't implement the spec's dt/dd implied-end-tag rule, and more severely, doesn't reliably match `</DL>` closes once more than one level of folder nesting is present — content kept nesting deeper regardless of closing tags. Both are real, pre-existing bugs in the shared tree-builder, unrelated to this feature and out of scope to fix here. Rather than build on top of unreliable parsing, `bookmark-html-format.ts` instead tokenizes the format's small fixed vocabulary (`<DT><A>`, `<DT><H3>`, `<DL>`, `</DL>`) with one regex and walks it with an explicit stack — exactly how real browsers' own bookmark importers work (a dedicated parser, not their page-rendering engine), and sidesteps the tree-builder bug entirely rather than working around it.

## Root Causes

1. **Nova's HTML5 tree-builder doesn't reliably close `<dt>`/`<dl>` nesting beyond one level**, confirmed via direct diagnostic DOM-tree dumps: missing the dt/dd implied-end-tag rule (a sibling `<dt>` doesn't auto-close a previous one without an explicit `</dt>`), and separately, explicit `</DL>` tags are not reliably matched/popped against the parse stack once more than one level of nesting exists. Both are real, deep, pre-existing bugs in the shared general-purpose parser — out of scope to fix as part of this small bookmark feature. Routed around by not using that parser at all: `parseNetscapeBookmarks()` tokenizes the format directly and tracks folder nesting via its own explicit stack, which depends on nothing from the general tree-builder.

## Notes

- `buildTreeFromService()` walks the real `BookmarkService` tree recursively via `getChildren(id)` per folder rather than a pre-populated `.children` field — confirmed `IBookmarkStore.getTree()` is literally `getChildren(null)`, not eagerly nested.
- Import creates a fresh "Imported <date>" folder rather than merging by title/URL match — avoids needing any conflict-resolution logic, matching real-browser convention.
- `BookmarkService.addBookmark()` deduplicates globally by URL (returns the existing entry in place rather than creating a second copy under a different parent) — a real, pre-existing design decision, not a bug, that shaped the integration test (importing must use URLs that don't already exist in the store, exactly like importing a file from elsewhere would in practice).
- Export is a clean no-op outside Electron (no `window.nova.process.downloadsDir`) rather than throwing — confirmed live in the dev-preview harness, which has no `window.nova` bridge (the same limitation hit verifying every recent download/IPC-backed phase). Import needed no such guard: `File.text()` is pure web platform, so it works identically in the harness and in a real packaged app, and was live-verified end to end in the dev preview (a real multi-level `.html` file imported into a real new folder, confirmed via the panel's own list).
- No native save/open dialog was added — `IRuntimeAdapter.showOpenDialog`/`showSaveDialog` remain permanently-stubbed dead code, confirmed never wired to Electron's real `dialog` module; building that bridge for this phase would be new, unrequested architecture.
- `ADD_DATE`/`ICON` attributes and any field beyond title/URL/folder structure are out of scope for this first cut.

## Files Modified

| File | Change |
|------|--------|
| `src/ui/pages/browser-window.ts` | New Export/Import buttons in `renderBookmarksPanel()`'s header; wired to the new format module and a hidden file input |

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/bookmarks/bookmark-html-format.ts` | Netscape Bookmark File Format parse/generate (dedicated tokenizer + explicit-stack parser) and `BookmarkService` tree walk/import helpers |
| `tests/bookmark-html-format.test.ts` | Round-trip, special-character escaping, a realistic external-file-shaped snippet (with and without explicit `</DT>` tags), empty-file handling, and a real `BookmarkService` export-then-import-elsewhere integration test |
| `doc/2026-10-01-bookmark-import-export-implemented.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 239/239 files (minus 3 pre-existing, unrelated DNS-resolver failures), 9385/9385 tests (6 new)
```

The 3 failing `tests/networking-integration.test.ts` DNS-resolver cases are pre-existing and untouched by this change — this machine's `dns.lookup('localhost')` currently resolves to IPv6 `::1` rather than the IPv4 the tests expect, the same environment condition noted in the last session's changelog.

## Verification Steps

1. Real-pipeline tests (no mocks): generate → parse round-trips a nested tree including a trailing top-level bookmark after a folder; special characters escape/unescape correctly; a realistic snippet parses correctly both with and without explicit `</DT>` closing tags (the tokenizer depends on `<DL>`/`</DL>` nesting only, not DT-closing semantics, unlike the abandoned DOM-based approach); an empty file returns `[]`; exporting a real `BookmarkService` tree and importing distinct "incoming" URLs elsewhere recreates the structure correctly.
2. Live dev-preview verification: opened `nova://bookmarks`, confirmed the Export/Import buttons render in the panel header; dispatched a real multi-level Netscape bookmark file through the Import flow (`File` + `change` event, pure web platform) and confirmed a new "Imported <date>" folder appeared in the list; clicked Export and confirmed it no-ops cleanly (no console error) in this harness's `window.nova`-less environment, matching the same documented limitation as every other `window.nova`-backed feature verified this session.
3. Ran the full suite — 0 regressions in any file this phase touched; the only failures are the 3 pre-existing, environment-dependent DNS tests noted above.
