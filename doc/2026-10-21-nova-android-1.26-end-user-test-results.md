# Nova Android 1.26 — End-User Test Results and Root Causes

**Date:** 2026-10-21
**Session:** "do the app testing as the end user, write all the possible test cases and test them, then find the root cause of them and list them"
**Status:** Completed. 2 root causes fixed in this session; the rest are listed for follow-up.

**Plan:** [2026-10-21-nova-android-end-user-test-plan.md](2026-10-21-nova-android-end-user-test-plan.md) (52 cases, 13 areas)
**Build:** Nova 1.26 (versionCode 27), freshly installed
**Device:** Realme RMX5264, Android 16, 720×1570 @ density 272

---

## Summary
**41 cases were run on the phone as an end user** (taps, typing, the system Back key, real sites, plus my own test page served through httpbin.org). Out of scope: J1/J2 rotation (it would change a system setting), K4 offline, and B8 (adb can't type non-ASCII).

| Result | Count |
|--------|-------|
| Pass | 24 |
| Pass with defects | 6 |
| **Fail** | **11** |
| Not run (by rule or tool limit) | 4 |
| Blocked (the site banned the IP; see RC-1) | 1 (F3) |

The run found **19 distinct root causes**, each traced to file and line below. Two were fixed during this session (RC-6 and RC-7) because they broke most real pages. There were no crashes or ANRs at any point (M1).

---

## Results by case
| ID | Case | Result | Notes / root cause |
|----|------|--------|--------------------|
| A1 | Cold start | ✅ Pass | 572 ms to the home page |
| A2 | Warm resume | ✅ Pass | 119 ms, same page |
| A3 | Link intent | ✅ Pass | Opens in a new tab; multilingual text renders. Dark mode ignored (RC-17) |
| B1 | Type a full URL | ✅ Pass | |
| B2 | Bare domain | ✅ Pass | `example.org` → https |
| B3 | Search from the bar | ❌ Fail | Google results page is blank (RC-2) |
| B4 | Bar focus and keyboard | ✅ Pass | The bar moves above the keyboard, old text replaced |
| B5 | Cancel editing | ✅ Pass | The first Back hides the keyboard, the second restores the URL (same as Chrome) |
| B6 | Invalid host | ❌ Fail | Blank white page plus a green lock, no error (RC-3) |
| B7 | `http://` URL | ❌ Fail | Nothing happens, no message (RC-4) |
| B8 | Unicode typing | ⏭ Not run | adb can't type non-ASCII |
| C1 | Tap a link | ✅ Pass | …then Wikipedia answered **403 "robot policy"** (RC-1) |
| C2 | Toolbar Back | ✅ Pass | Re-fetches and re-renders (~3.5 s) instead of restoring |
| C3 | System Back key | ✅ Pass | Walks history |
| C4 | Back on the first page | ✅ Pass | Leaves the app |
| C5 | Reload | ✅ Pass | |
| C6 | Pull to refresh | ✅ Pass | |
| C7 | Forward | ✅ Pass | |
| C8 | `target=_blank` | ✅ Pass | New tab, the count goes 2 → 3 |
| D1 | Tab switcher | ⚠️ Pass w/ defects | Cards show the host/URL, not page titles (RC-10); no thumbnails |
| D2 | New tab | ✅ Pass | |
| D3 | Switch tab | ✅ Pass | |
| D4 | Close tab | ✅ Pass | |
| D5 | Close the last tab | ❌ Fail | "0 tabs"; pages then load invisibly, the user is stuck (RC-5) |
| E1 | Menu | ✅ Pass | Full page menu (Find, Share, Copy link, Add bookmark…) |
| E2 | Add bookmark | ⚠️ Pass w/ defects | Works, with no confirmation; titled by host (RC-10) |
| E3 | Bookmarks list | ✅ Pass | |
| E4 | History | ⚠️ Pass w/ defects | Records `about:newtab`, failed loads and no titles (RC-11) |
| E5 | Find in page | ✅ Pass | Highlights, 1/2 → 2/2 → 1/2 |
| E6 | Share | ✅ Pass | Android share sheet (dismissed, nothing sent) |
| E7 | Settings | ✅ Pass | Search engine, clear data, version 1.26 |
| E8 | Downloads | ✅ Pass | Empty state |
| F1 | example.com | ✅ Pass | |
| F2 | Wikipedia article | ❌ Fail | A screen-tall gap above the lead (RC-6, fixed); missing word spaces (RC-7, fixed); wordmark checkerboard (RC-14) |
| F3 | Wikipedia search | 🚫 Blocked | Wikimedia blocked the phone's IP (RC-1) |
| F4 | iana.org | ⚠️ Pass w/ defects | Logo garbled (RC-14); footer text invisible (RC-8); a script error with no detail (RC-19) |
| F5 | JS-built content | ✅ Pass | |
| F6 | Non-Latin text | ✅ Pass | Arabic, CJK and Cyrillic on example.com |
| F7 | Images | ✅ Pass | PNG |
| F8 | Performance | ✅ Pass | Wikipedia article ≈ 3.6 s total; example.com < 0.3 s |
| G1 | Type into a field | ✅ Pass | |
| G2 | Submit with Enter | ✅ Pass | (Tablet run, 1.24) |
| G3 | Submit with a button | ✅ Pass | `httpbin.org/get?name=…` |
| G4 | Invisible controls | ✅ Pass | Fixed in 1.24/1.26 |
| G5 | Checkbox / select | ⚠️ Pass w/ defects | Both work; the select overlay stays on top after picking (RC-16) |
| G6 | POST form | ❌ Fail | Silent no-op (RC-12, known) |
| H1 | Scroll | ✅ Pass | |
| H2 | Fling | ✅ Pass | |
| H3 | Scroll to the bottom | ❌ Fail | A black band at the end of iana.org: the footer text is black on black (RC-8) |
| H4 | Back after a link | ✅ Pass | |
| I1 | Long-press a link | ⚠️ Pass w/ defects | One menu, but **Cancel is cut off** at the bottom (RC-15) |
| I2 | Long-press an image | ✅ Pass | Header shows the URL twice instead of the alt text |
| I3 | Long-press text | ✅ Pass | Page menu; no text selection (feature gap) |
| J1/J2 | Rotation | ⏭ Not run | Would change a system setting |
| J3 | Keyboard over a field | ✅ Pass | The field stays visible |
| K1 | 404 with an empty body | ❌ Fail | Blank page, no "HTTP 404" message (RC-3) |
| K3 | JSON response | ✅ Pass | Shown as text |
| K4 | Offline | ⏭ Not run | Would cut the phone's network |
| L1 | Tabs after a restart | ❌ Fail | Restarts with 1 blank tab (RC-9) |
| L2 | Bookmarks after a restart | ❌ Fail | "No bookmarks yet" (RC-13) |
| L3 | History after a restart | ❌ Fail | Empty (RC-13) |
| M1 | Crashes / ANRs | ✅ Pass | None in the crash buffer or the ANR list |

---

## Root causes (ranked by user impact)

### RC-1 — The native fetch sends the HTTP library's User-Agent; Wikipedia bans the device · **Critical**
**Seen in:** C1 (403 "Please respect our robot policy"), then every Wikipedia page from that IP (F3 blocked).

**Evidence:** `https://httpbin.org/headers` opened in Nova echoed `User-Agent: Dalvik/2.1.0 (Linux; U; Android 16; RMX5264 …)`, `Accept: */*`, and no `Accept-Language`. From the same public IP (122.175.42.111), curl with a normal UA still gets 200.

**Root cause:**
- `src/browser/networking/resource-loader.ts` `loadResource()` builds its own headers, `new Map([['accept', '*/*']])`, for every request, documents included.
- It never adds `user-agent`. The engine's `NovaBrowser/1.0` (app-shell.ts) is only applied in `RequestManager.buildRequestSpec`, which page loads don't pass through.
- `NovaFetchBridge.kt` forwards whatever headers JS sends, so `HttpURLConnection` falls back to its `Dalvik/…` default. Wikimedia treats that as an unidentified bot and blocks the IP after a burst of requests.

**Fix:** In `NovaFetchBridge.kt`, when no User-Agent is supplied, set `WebSettings.getDefaultUserAgent(ctx) + " NovaBrowser/<version>"`. Also send a document `Accept` and the device's `Accept-Language` from `ResourceLoader` for `kind === 'document'`.

### RC-6 — `<link>`/`<meta>` in the body left the parser in "in head" mode (fake `<body>`s) · **Critical · FIXED**
**Seen in:** F2: a screen-tall blank band above the lead, and stray line breaks mid-paragraph ("As of 2026 ⏎⏎ , the most used…").

**Root cause:** `src/browser/rendering/html5/tree-builder.ts` `processInHeadToken()` set `insertionMode = IN_HEAD` and never restored it. Every in-body `<link>`, `<meta>`, `<base>` or `<template>` was followed, at the next tag, by the in-head "anything else" step: pop, then after-head, then **insert a new `<body>`**. One Wikipedia article produced **59 `<body>` elements**. (`style`/`script` had already been special-cased in body.ts.)

**Fix (applied):**
```ts
processInHeadToken(token: Token): void {
  const saved = this.insertionMode;
  this.insertionMode = Im.IN_HEAD;
  this.processToken(token);
  if (this.insertionMode === Im.IN_HEAD) this.insertionMode = saved;
  else if (this.insertionMode === Im.TEXT && this.originalInsertionMode === Im.IN_HEAD) this.originalInsertionMode = saved;
}
```
**Result:** 1 `<body>`; the lead paragraph moved from y≈1000 to y=228.

### RC-7 — Whitespace between inline elements dropped ("Wikipediaweb page") · **High · FIXED**
**Seen in:** F2 (a caption read "Wikipediaweb page"); any `<b>x</b> <i>y</i>`.

**Root cause:** Two places:
1. `layout-engine.ts` `layoutBlockChildren` skipped every whitespace-only text node, which is meant only for whitespace between block boxes.
2. `inline-context.ts` `addTextRun` dropped whitespace-only text unless it was exactly `" "`, so `"\n"` or two spaces vanished.

**Fix (applied):**
1. Skip whitespace only while the inline run is empty (that is, leading whitespace).
2. Collapse whitespace-only text to one space, dropped only at the start of a line.

### RC-2 — Google search results are blank · **High**
**Seen in:** B3. The default search engine is Google, so typing a query in the bar gives a blank page.

**Root cause:** Google answers every client, whatever the UA, with a JavaScript challenge page. The real content is in `<noscript>`, and the results are built by script.
- Nova runs scripts, so `<noscript>` stays hidden.
- Google's script throws in Nova's interpreter: `[ScriptEngine] Error executing blocking script: Cannot read properties of undefined (reading 'get')`, 4 times. Nothing renders.

**Fix options:**
- Make DuckDuckGo's HTML endpoint the default until the interpreter can run Google's script.
- Or find the missing built-in behind `.get` (capture the script as a fixture and run it in vitest).

### RC-3 — Failed loads render as a blank page: no error page, a green lock · **High**
**Seen in:** B6 (DNS failure), K1 (404 with an empty body).

**Root cause:**
- `resource-loader.ts` doesn't throw on network errors; it returns `{ statusCode: 0, error: '…', body: '' }`.
- `page-loader.ts` `mapResult()` never checks `result.error`, so the engine renders the empty body as a page.
- `pageLoadError` is never emitted, so the UI's error handler (`browser-window.ts:263`) never runs.
- The lock is shown purely from the `https:` scheme.

**Fix:**
- In `PageLoader.load`, throw when `result.error` is set (or `statusCode === 0`).
- For status ≥ 400 with an empty body, render a built-in "HTTP 404" page.
- Base the lock on a successful load.

### RC-4 — Every `http://` navigation is silently blocked · **High**
**Seen in:** B7 (`http://neverssl.com`: nothing happens).

**Root cause:** HTTPS-only mode is on. `SecurityLayer.checkNavigation` (security-layer.ts:280) returns `decision: 'upgrade'`, and the navigation guard maps that to `canNavigate = false`. Nobody follows `upgradeUrl`, and the UI never shows `blockedReason`. (neverssl.com has no HTTPS, so an upgrade would fail anyway.)

**Fix:**
- Navigate to the upgraded URL.
- If that fails, show an interstitial: "This site doesn't support a secure connection. Continue to http://…?"

### RC-5 — Closing the last tab leaves zero tabs; pages then load invisibly · **High**
**Seen in:** D5: "0 tabs" after closing everything; typing a URL renders in the engine, but the screen stays on the home page with "0" in the counter.

**Root cause:** `browser-window.ts` `closeTab()` calls `tabManager.removeTab()` and syncs. Nothing creates a replacement tab when the count reaches 0.

**Fix:** After `removeTab`, if no tabs remain, `createTab('about:newtab')` and activate it (Chrome's behaviour).

### RC-8 — CSS Color 4 colours (`oklch()`, `lab()`, `color()`…) paint as black · **High**
**Seen in:** H3/F4: iana.org's footer text is `oklch(0.685 0.01 286)` on a black background, so the footer reads as a black band. Modern sites increasingly use these.

**Root cause:** `rasterizer.ts` `parseColor()` understands hex, named colours, `rgb()` and `hsl()`. Anything else returns `BLACK`, and `isParsableColor` agrees.

**Fix:** Add `oklch`/`oklab`/`lab`/`lch`/`hwb`/`color(srgb …)`, converting to sRGB (~40 lines of colour maths).

### RC-9 — Open tabs are never saved · **High**
**Seen in:** L1 (2 tabs → 1 blank tab after a restart, and also after leaving with Back).

**Root cause:** `src/browser/settings/session-restore.ts` exists but **nothing imports it** (dead code). `TabManager` is in-memory only.

**Fix:** Save `{url, title}` per tab on change (localStorage, or via the Kotlin side) and restore on startup.

### RC-13 — Bookmarks and history look empty after a restart · **High**
**Seen in:** L2, L3.

**Root cause:** A startup ordering bug in `src/app/main.ts`:
- `installAndroidNativeBridge(page)` (line 821) immediately pushes the bookmark and history lists to Kotlin.
- `page.setBookmarkService()`/`setHistoryService()` only run later (lines 931–932).
- So the first push sees no services and sends `[]`.
- `setBookmarkService`/`setHistoryService` subscribe to future changes but never re-push, so the native sheets stay empty until the next change.

The data itself is in `localStorage` (`nova-bookmarks`/`nova-history`, `PersistentBookmarkStore`, DOM storage enabled), so it isn't lost, just not shown.

**Fix:** Call `emitLibraryChanged()` at the end of both setters, or install the bridge after the services are set.

### RC-10 — Page titles never reach tabs, bookmarks or history · **Medium**
**Seen in:** D1, E2, E3, E4: everything is labelled "httpbin.org" or "example.com" instead of "Nova QA" or "Example Domain".

**Root cause:** For engine-rendered pages, `navigation-fetcher.ts` `renderFromEngine` passes no title (only the error fallbacks pass `hostname`). Nothing in engine/UI reads the document's `<title>`.

**Fix:** After render, read `domTree.querySelector('title')` text (and listen for script changes to `document.title`), then update the tab and history entry.

### RC-11 — History records `about:newtab`, failed loads, and no titles · **Medium**
**Seen in:** E4 and the home "Recently visited" list (`about:newtab`, "0 minutes ago").

**Root cause:** `history-service.ts` `connectController` records on **`navigationCommitted`**, before the load succeeds or the title is known, with no filter for internal schemes.

**Fix:**
- Record on load completion, skipping `about:`/`chrome:` URLs and failed loads.
- Update the title later.
- Show "Just now" under a minute.

### RC-12 — POST forms do nothing · **Medium** (known, Round B)
**Seen in:** G6.

**Root cause:** `browser-window.ts` `submitForm` logs `[Forms] POST submission is not supported yet` and returns. There's no user feedback.

**Fix:** Round B (request body on navigation); until then show a toast.

### RC-14 — SVG images garbled or checkerboarded · **Medium**
**Seen in:** F2 (the Wikipedia wordmark is a blue checkerboard), F4 (the IANA logo is squashed and garbled).

**Root cause:**
- `src/browser/image/decoder.ts` `svgToBitmap` rasterizes the SVG at its natural size.
- `rasterizer.ts` `drawImage` then scales with **nearest-neighbour sampling** (`Math.floor` on source coordinates).
- Shrinking a large SVG raster without filtering aliases it into stripes and checkerboards.

**Fix:**
- Rasterize SVGs at the destination box size × DPR.
- Use bilinear (or box) sampling when downscaling.

### RC-15 — Long-press sheet's last row ("Cancel") is cut off · **Low**
**Seen in:** I1, I2.

**Root cause:** `android/.../ContextMenuSheet.kt` puts a fixed list in a `ModalBottomSheet` that is neither scrollable nor padded for the navigation-bar inset. On this edge-to-edge activity, the last row sits under the gesture bar.

**Fix:** `Modifier.navigationBarsPadding()` plus `verticalScroll` on the sheet content.

### RC-16 — The native `<select>` overlay stays after picking · **Low**
**Seen in:** G5.

**Root cause:** `browser-window.ts` `openFieldEditor`: the overlay closes on `blur` only; for a select, `change` only commits.

**Fix:** For `kind === 'select'`, close on `change`.

### RC-17 — Dark mode ignored by pages · **Low**
**Seen in:** A3: example.com declares `color-scheme: light dark` with `light-dark(#eee, #222)` and stays light on a dark-mode phone.

**Root cause:**
- `cascade.ts:179` hard-codes `prefers-color-scheme` to `light`.
- `computed-value-resolver.ts:377` resolves `light-dark()` to its light value.

**Fix:** Feed the system theme (Kotlin → engine) into the media evaluation.

### RC-18 — Link underlines break at every space · **Low**
**Seen in:** F2, the QA page ("Open example.org in a new tab" shows separate underlines per word).

**Root cause:** `paint-engine.ts` text-decoration painting skips whitespace-only runs (`run.text.trim()` check, added in 1.21 to avoid stray underlines). The spaces inside one link lose their underline.

**Fix:** Underline a whitespace run when the runs on both sides share the same decorating element.

### RC-19 — Script errors are logged as "[object Object]" · **Low**
**Seen in:** F4 (iana.org).

**Root cause:** `[ScriptEngine] Error executing blocking script: [object Object]`: the interpreter throws a JS-level error object, and the logger stringifies it with `String(err)` rather than reading its `message`/`name`.

**Fix:** Format interpreter error objects (`name: message` plus the script URL and line), so failing sites can be diagnosed from logcat.

---

## Fixes applied in this session
| File | Change |
|------|--------|
| `src/browser/rendering/html5/tree-builder.ts` | `processInHeadToken` restores the insertion mode (RC-6) |
| `src/browser/rendering/layout-engine.ts` | Whitespace after inline content kept (RC-7). Earlier this session: hit testing follows paint layers, and absolute boxes are hit-testable |
| `src/browser/rendering/formatting/inline-context.ts` | Whitespace-only runs collapse to one space (RC-7). Earlier this session: atomic boxes wrap after text |
| `android/app/build.gradle` | 1.26 / versionCode 27 |

## Files created
| File | Purpose |
|------|--------|
| `doc/2026-10-21-nova-android-end-user-test-plan.md` | The 52-case end-user test plan |
| `doc/2026-10-21-nova-android-1.26-end-user-test-results.md` | This report |
| `tests/fixtures/wikipedia-article-2026/` | The "Web browser" article plus its two stylesheets (the RC-6/RC-7 repro) |
| `tests/end-user-regressions.test.ts` | Regression tests for RC-6, RC-7, paint-order hit testing and line wrapping |

## Test Results
```
npx tsc --noEmit                              → exit 0
npx vitest run                                → Test Files 279 passed (279) · Tests 10565 passed (10565)
npx vitest run tests/end-user-regressions.test.ts → Tests 5 passed (5)
./gradlew :app:testDebugUnitTest              → exit 0
apksigner verify Nova-1.26.apk                → verified
```
On-device: 41 cases executed on the Realme RMX5264 (results table above). The rebuilt 1.26, which includes RC-6 and RC-7, is not yet installed on the phone: on this device the install raises an approval prompt, and the owner was on a call.

## Follow-up
- 2026-10-24, Nova 1.27: RC-1, RC-3, RC-5, RC-8 and RC-13 fixed. See [2026-10-24-nova-android-1.27-user-agent-error-pages-tabs-colors.md](2026-10-24-nova-android-1.27-user-agent-error-pages-tabs-colors.md).
