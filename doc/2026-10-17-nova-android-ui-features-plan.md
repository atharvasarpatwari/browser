# Nova Android — UI Redesign, Missing Features & Device Testing — Plan

**Date:** 2026-10-17
**Session:** "I want you to alter the android app". The user picked missing browser features, UI/layout redesign, and fixing bugs on a real device.
**Status:** Completed. Approved (bottom bar; settings, new-tab page, find, pull-to-refresh; phone over USB) and implemented as Nova 1.9; see `2026-10-17-nova-android-ui-features.md`. Find and pull-to-refresh turned out to need engine scrolling, so `claude/search-subsystem` was merged in (user-approved).

---

## The app today (traced this session)
- **Screen** (`ui/BrowserScreen.kt`, about 1.3k lines across `ui/`): a `Scaffold` with a **top** `TabsBar` (horizontal strip, with incognito and new-tab buttons) and an `AddressBar` (star, reload/stop, overflow with Copy/Share URL); then the page (`EngineWebView` + `ErrorPage`); then a **bottom** bar with back, forward, downloads and library (Bookmarks & History sheet). Sheets: Downloads, Bookmarks/History, long-press ContextMenu.
- **Engine bridge** (`src/app/android-native-bridge.ts`): navigate/back/forward/reload/stop, tabs, bookmarks, history, download, openInNewTab, setIncognito. No find, zoom, scroll position, or settings calls.
- **Find in page:** `src/browser/navigation-controls/find-in-page.ts` matches text, but it isn't wired to the page and can't highlight or scroll to a match on the painted canvas.
- **Design reference:** the published "Nova Browser Interface" canvas (`artifact 69b6fd82…`) is desktop-only (two 1440×900 artboards). Its **New Tab** page (greeting with time/date, search box, shortcut tiles for Settings/Downloads/Bookmarks/History, a "Recently visited" list) carries over to mobile.
- **Devices:** `adb devices` shows nothing attached, and the emulator still reports "hypervisor driver is not installed" (the driver package is downloaded; the admin install is the user's step).

## Phase 1 — UI redesign + native features (Kotlin/Compose only, no engine changes)
1. **Bottom, one-handed chrome:** a single bottom bar with back · address pill · tab count · menu (⋮). The address pill expands to the full editor when tapped. A thin progress line shows while the page loads. Top of the screen goes to page content. *(Optional: keep the bar at the top; see question.)*
2. **Tab switcher:** a full-screen grid of tab cards (title, host, initial-letter badge, close ✕), "+ New tab", and a Normal/Incognito toggle. It replaces the always-visible tab strip. Swipe a card to close it.
3. **Native New Tab page** (from the design canvas): shown when the active tab is on the home URL. Greeting with time/date, a search box, shortcut tiles (Bookmarks, History, Downloads, Settings) and "Recently visited" (the last 5 history entries). Light/dark per the Nova Flash theme.
4. **Overflow menu (⋮):** New tab, New incognito tab, Bookmarks, History, Downloads, Share page, Copy link, Settings.
5. **Settings screen:**
   - **Search engine:** Google / DuckDuckGo / Bing / Brave. This overrides the engine's `searchTemplate` when resolving address-bar input, stored in SharedPreferences (no new dependency).
   - **Clear browsing data:** history (`novaNative.clearHistory`), cookies (new `NativeCookieJar.clear()`), and the downloads list (files optional).
   - **About:** version.
6. **Tests:** JVM unit tests for search-template selection and cookie clearing; Compose UI isn't unit-tested (no Robolectric dependency added).

## Phase 2 — features that need engine work (only if wanted)
- **Find in page:** a bridge call plus engine painting of match highlights and scroll-to-match. This is real engine work.
- **Pull-to-refresh:** needs the engine to report "page scrolled to top" in the state snapshot.
- **Desktop site / text size:** needs a user-agent switch and a page-zoom call on the bridge (desktop has `zoomChanged` plumbing to reuse).

## Phase 3 — real-device testing and fixes
Needs **either** your phone plugged in with USB debugging on, **or** the emulator driver installed (`silent_install.bat` as admin). Then:
- `npm run android:smoke-test` (8 checks);
- `npm run android:feature-test -- --ui` (16 checks + UI checks U1–U4);
- the manual checklist (`doc/2026-09-06-android-manual-test-checklist.md`);
- screenshots of the new UI in light and dark.

Every failure gets a root-cause fix and a re-run, and goes in the change log.

## Deliverables
Change log `doc/2026-10-17-nova-android-ui-features.md` with README/analytics entries, and Nova APK **1.9**.
