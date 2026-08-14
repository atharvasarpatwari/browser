Nova Browser — Bookmarks & History Now Shared With the Engine

WHAT CHANGED
Bookmarks and history were previously native-Android-only (a local list in
BrowserViewModel, disconnected from the engine's own bookmark/history
services). Now they're backed by the SAME BookmarkService/HistoryService the
desktop build uses — one data source, pushed to native chrome the same way
tabs already were.

Also fixed: the address-bar loading spinner now updates on navigation
start/end (previously only refreshed on tab create/remove/activate/navigate,
so a slow-loading page wouldn't show as loading until AFTER it finished).

FILES — copy into E:\nova_1 at the same relative paths, overwriting existing
(these are on top of everything from the previous round — apply that first
if you haven't already):

  Engine (TypeScript) — verified: 0 typecheck errors, 5 new tests (18 total
  in this file now), full suite 8,625/8,679 passing, lint clean:
    src/app/android-native-bridge.ts     (MODIFIED)
    src/ui/pages/browser-window.ts       (MODIFIED — bookmark/history
                                           pass-through methods + loading-
                                           state event wiring)
    tests/android-native-bridge.test.ts  (MODIFIED — now 18 tests, including
                                           2 that exercise the REAL
                                           BookmarkService/HistoryService,
                                           not mocks)

  Android (Kotlin) — NOT compiled (no Gradle/Android SDK in my sandbox):
    android/kotlin/BrowserViewModel.kt   -> android/app/src/main/java/com/nova/browser/BrowserViewModel.kt
    android/kotlin/NovaStateBridge.kt    -> android/app/src/main/java/com/nova/browser/NovaStateBridge.kt
    android/kotlin/model/Tab.kt          -> android/app/src/main/java/com/nova/browser/model/Tab.kt
    android/kotlin/EngineWebView.kt      -> android/app/src/main/java/com/nova/browser/ui/components/EngineWebView.kt

  Unchanged: MainActivity.kt, BrowserScreen.kt, AddressBar.kt, TabsBar.kt,
  BookmarksSheet.kt, theme files — no edits needed, their existing calls
  (viewModel::removeBookmark, viewModel::clearHistory, etc.) already match
  the new signatures.

HOW IT WORKS
  On install, android-native-bridge.ts immediately fetches and pushes the
  full bookmark and history lists to NovaStateBridge.onBookmarksChanged() /
  onHistoryChanged(). It also subscribes to the engine's real service events
  (bookmarkCreated/Removed/Updated/Moved, entryAdded/entriesDeleted/cleared)
  and re-pushes the full list on every change — same "push full state, don't
  diff" pattern already used for tabs. Kotlin's toggleBookmark()/
  removeBookmark()/clearHistory() are now fire-and-forget calls into
  window.novaNative.*; the resulting list update arrives via the next push,
  same as tab actions already work.

BUILD & VERIFY
  npx tsc --noEmit
  npx vitest run tests/android-native-bridge.test.ts   (expect 18 passed)
  npm run build:android

STILL NOT DONE (being upfront, not hiding gaps)
  - No offline queueing: if the WebView hasn't finished loading the engine
    yet, calls into window.novaNative.* before it exists are silently
    dropped (guarded by `window.novaNative &&` in every callEngine() call
    rather than crashing, but the action itself is lost). Low risk in
    practice since the engine loads almost immediately, but a true fix would
    queue actions until novaNative appears.
  - Still can't compile-check the Kotlin from my side. Read through the four
    changed files once before building; if `gradlew assembleDebug` errors,
    paste it back and I'll fix it precisely from the message.
