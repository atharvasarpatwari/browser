# Page Right-Click Menu and Contextual Search — Links, Images and the Page

**Date:** 2026-10-05
**Session:** Second of four follow-ups (Electron verification → page right-click menu → speculative DNS warm-up → fuzzy search + archive scale)
**Status:** Completed — verified in the real Electron app; three pre-existing defects found and fixed on the way

---

## Summary

Plan §3.5.1 (contextual search), minus text selection (the page is a bitmap with no selection model). The desktop browser had a right-click menu only on tabs; right-clicking a rendered page did nothing. Now:

| Over | Menu |
|---|---|
| a link | **Open link in new tab** · **Copy link address** · **Search <engine> for “link text”** · **Ask Nova AI about “link text”** |
| an image | **Open image in new tab** · **Copy image address** · **Search image with Google Lens / Bing Visual Search / TinEye** (greyed out for images no outside service could fetch: non-http(s), IP addresses, `localhost`, intranet/`.local`/`.home` names, URLs with credentials) |
| an image inside a link | both groups, link first |
| plain page | **Back** · **Forward** · **Reload** — **Find in page…** · **Copy page address** |

Page-controlled text (link text) appears in labels as one short quoted line and is only ever sent anywhere when the user clicks the item. Built-in pages (`nova://…`, real DOM) and the mobile/Android layout are untouched.

## Design

- **`buildPageContextMenu(target, context, actions)`** (`src/ui/components/context-menu/page-context-menu.ts`) is a pure function from "what is under the pointer" to `ContextMenuItem[]` (reusing the existing `ContextMenu`): no leading/trailing/double separators, labels name the user's default engine.
- **`PageContextMenuController`** listens for `contextmenu` on the content area. The click lands on the page bitmap scaled into the content area (`object-fit: contain`), so it is mapped back to bitmap coordinates with the **inverse of the find overlay's transform** (`pointToFrame`, next to `computeViewTransform`; the letterbox margins are "the page, not a link") and hit-tested with the existing `BrowserWindowPage.resolveContextTarget` (built for Android long-press). Only the page `<canvas>` triggers it.
- **`reverseImageSearchLinks()`** (`src/browser/search/image-search.ts`) reuses `isWarmableHost` (public named hosts only) so a LAN or credentialed address is never handed to a third party.
- `SearchIntegration` gained `searchFor` (default engine, **new tab**, like the browser's own menu), `askAi` and `copyText` (the omnibox's copy action now shares it). The window wires the controller in the desktop layout only and disposes it on unmount.

## Root Causes (three pre-existing defects the real app exposed)

### 1. `resolveContextTarget` threw on every real page — links and images never resolved
**File:** `src/ui/pages/browser-window.ts`
**Problem:** walking up from the hit element, it called `node.tagName.toLowerCase()` on every ancestor — but the chain ends at the document node, which has no `tagName`: `TypeError: Cannot read properties of undefined (reading 'toLowerCase')`. Unit tests used hand-made chains ending at an element, so they never saw it; the Android bridge wraps the call in `try/catch`, so long-press on a link or image on a device has been silently empty. Found by a real right-click in Electron that showed the *page* menu over a link: a temporary log showed the hit test returning the anchor, then the controller swallowing the exception.
**Fix:**
```ts
// The top of the chain is the document node, which has no tag name.
const tag = typeof node.tagName === 'string' ? node.tagName.toLowerCase() : '';
```
Regression test with a real-shaped tree (lower-case tags, `parent` chain ending in a document node) in `tests/android-native-bridge.test.ts` — it fails with the original `TypeError` without the guard. The controller now logs hit-test failures (`console.error`) instead of swallowing them silently.

### 2. `ContextMenu` closed the next menu in the very event that opened it
**File:** `src/ui/components/context-menu/context-menu.ts`
**Problem:** `show()` registered `mousedown`/`contextmenu` listeners on the document that were removed only when an *outside click* closed the menu — not when an item was chosen, when `show()` replaced an open menu, or via `hide()`. After "right-click, choose an item", the stale listener sat on the document; the next right-click opened a new menu, the event bubbled to the document, and the stale listener closed it again at once (a flash). The same applied to the tab context menu. Found when the second right-click in the Electron test produced no menu.
**Fix:** one `dismiss` handler per menu, removed by `hide()` however the menu closes (and its arming timer cancelled); Escape now closes the menu too.
```ts
hide(): void {
  if (this.armTimer) { clearTimeout(this.armTimer); this.armTimer = null; }
  if (this.dismiss) {
    document.removeEventListener('mousedown', this.dismiss);
    document.removeEventListener('contextmenu', this.dismiss);
    document.removeEventListener('keydown', this.dismiss);
    this.dismiss = null;
  }
  …
}
```
New `tests/context-menu.test.ts` (9 tests; the component had none) — three of them fail without the cleanup.

### 3. Relative links and images stayed relative
**File:** `src/ui/pages/browser-window.ts`
**Problem:** `resolveContextUrl` resolved against `this.currentUrl`, a field that is never assigned, so `href="/about"` came back as `/about` — useless for "open in a new tab", and for the Android native menu.
**Fix:** resolve against the page the navigation bridge is on: `new URL(raw, this.navigationBridge?.currentUrl || undefined)`. Window-level test (a page at `https://example.com/docs/index.html`, link `/about` → `https://example.com/about` opened in a new tab) fails on the old field.

## Files Modified

| File | Change |
|------|--------|
| `src/ui/components/context-menu/context-menu.ts` | listener cleanup on every close, Escape closes (root cause 2) |
| `src/ui/components/find-bar/find-overlay.ts` | `pointToFrame` — inverse of the `object-fit: contain` transform |
| `src/ui/pages/browser-window.ts` | `PageContextMenuController` wiring (desktop only); `resolveContextTarget` tag-name guard (1); `resolveContextUrl` base (3) |
| `src/ui/pages/search-integration.ts` | `searchFor`, `askAi`, `copyText` |
| `tests/search-integration.test.ts` | +9 (window level: link, relative resolution, search/ask in a new tab, engine from Settings, copy, image + lookup, page menu + Find, no menu on built-in pages, not in the mobile layout, stops after unmount) |
| `tests/android-native-bridge.test.ts` | +1 (root cause 1) |
| `tests/e2e/helpers/electron-app.ts` | `/links` page (link block and image in normal flow), `rightClickPage`, page ↔ window coordinate mapping |
| `tests/e2e/search-electron.spec.ts` | +1 end-to-end test |

## Files Created

| File | Purpose |
|------|---------|
| `src/ui/components/context-menu/page-context-menu.ts` | menu builder + right-click controller |
| `src/browser/search/image-search.ts` | reverse-image lookups for public images |
| `tests/page-context-menu.test.ts` | 15 (builder, `pointToFrame`, controller incl. letterbox) |
| `tests/image-search.test.ts` | 17 |
| `tests/context-menu.test.ts` | 9 |
| `doc/2026-10-05-page-context-menu.md` | this change log |

## Test Results

```
$ npx tsc --noEmit                                  (includes tests/e2e/*)
(no output, exit 0 — 0 errors)

$ npx vitest run tests/image-search.test.ts tests/page-context-menu.test.ts tests/context-menu.test.ts \
                 tests/search-integration.test.ts tests/android-native-bridge.test.ts tests/find-bar.test.ts
 Test Files  6 passed (6)
      Tests  241 passed (241)

$ npm run build:web
$ npx playwright test --config=playwright-electron.config.cjs tests/e2e/search-electron.spec.ts tests/e2e/electron-smoke.spec.ts tests/e2e/keep-alive.spec.ts
  ok 9 tests (smoke, keep-alive, 7 search incl. "right-clicking a rendered page offers its links, its images and the page itself")
  9 passed (59.6s)

$ npx vitest run            (full suite)
 Test Files  1 failed | 252 passed (253)
      Tests  3 failed | 10197 passed (10200)
   Duration  306.11s
```

The vitest suite grew from 10,149 to 10,200 tests (+51: image search 17, page menu 15, `ContextMenu` 9, window level 9, real-tree hit test 1) and the Playwright suite from 8 to 9 passing specs. The 3 failures are the same known environmental ones — `tests/networking-integration.test.ts › DnsResolver - real system resolution` (the real resolver's `localhost` lookup times out after 5 s on this machine) — unrelated to this change.

## Verification

- **Real Electron** (`tests/e2e/search-electron.spec.ts › right-clicking a rendered page offers its links, its images and the page itself`): a real right-click on a link block shows search / ask / copy items (the OS clipboard receives `http://127.0.0.1:<port>/quasar` — the relative `href` resolved); "Open link in new tab" opens a second tab that loads the page; a right-click on an image offers open / copy and a *greyed-out* lookup (the image is on 127.0.0.1) and copies the image address; a right-click on empty page offers Back/Forward/Reload/Find/Copy address and "Find in page…" opens the find bar.
- **How the three defects were found:** the first Electron runs showed the page menu over a link (→ 1), the second right-click showed nothing (→ 2), and the window-level test of relative links was written while reading the code for (1) (→ 3).
- **Mutation checks:** no `tagName` guard → the real-tree regression throws; no listener cleanup → 3 `ContextMenu` tests fail; the unmapped client coordinates → 2 controller tests fail; no public-host rule → 8 image-search tests fail; `resolveContextUrl` on the dead field → the relative-link test fails; listener never attached → 6 window tests fail.
- **Not done (still out of scope):** "search for the selected text" / "Ask Nova AI about the selection" need a text-selection model on the bitmap page; the menu is built so a selection group can be added at the top. Separately noted earlier: engine-painted text overlaps in real pages (a spun-off task).
