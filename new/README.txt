Nova Browser — Hybrid Native Chrome (Compose UI driving the engine via JS bridge)

WHAT THIS IS
Native Android chrome (address bar, tab strip, bookmarks/history — Jetpack
Compose) now drives your TypeScript engine's tabs/navigation through a JS
bridge, instead of a) the engine's own web-rendered chrome, or b) a native
WebView navigating real URLs directly. There is exactly ONE WebView, created
once, hosting the engine for the app's lifetime. The engine owns all tab
state; Kotlin only reflects it and dispatches actions into it.

FILES — copy into E:\nova_1 at the SAME relative paths, overwriting existing:

  Engine (TypeScript) — also verified: 0 typecheck errors, 32 new tests
  passing, no regressions in the full 8,674-test suite:
    src/app/main.ts                          (MODIFIED)
    src/app/android-native-bridge.ts         (NEW)
    src/ui/pages/browser-window.ts           (MODIFIED — new hideChromeUI
                                               config + getChromeState()/
                                               onChromeState()/createTab()/
                                               closeTab()/activateTabExternal())
    tests/android-native-bridge.test.ts      (NEW — 13 tests)
    (from the PREVIOUS round, still needed if not already applied:
     src/browser/js/web-models.ts, src/browser/js/index.ts,
     src/browser/js/fetch-api.ts, tests/web-models.test.ts)

  Android (Kotlin) — I could NOT compile/typecheck these; Gradle + the
  Android SDK aren't reachable from my sandbox. Review before building.
    android/app/build.gradle -> android/app/build.gradle
       (only change: added lifecycle-viewmodel-compose dependency)
    android/kotlin/MainActivity.kt              -> android/app/src/main/java/com/nova/browser/MainActivity.kt
    android/kotlin/BrowserViewModel.kt           -> android/app/src/main/java/com/nova/browser/BrowserViewModel.kt
    android/kotlin/NovaStateBridge.kt            -> android/app/src/main/java/com/nova/browser/NovaStateBridge.kt   (NEW)
    android/kotlin/model/Tab.kt                  -> android/app/src/main/java/com/nova/browser/model/Tab.kt
    android/kotlin/ui/BrowserScreen.kt           -> android/app/src/main/java/com/nova/browser/ui/BrowserScreen.kt
    android/kotlin/ui/components/AddressBar.kt   -> android/app/src/main/java/com/nova/browser/ui/components/AddressBar.kt
    android/kotlin/ui/components/EngineWebView.kt -> android/app/src/main/java/com/nova/browser/ui/components/EngineWebView.kt   (NEW,
       replaces the deleted android/app/.../webview/BrowserWebView.kt — delete
       that old file and its now-empty webview/ folder after copying)

  Unchanged, still used as-is: TabsBar.kt, BookmarksSheet.kt, ui/theme/*.kt,
  NovaFetchBridge.kt.

HOW IT WORKS
  1. EngineWebView.kt creates ONE WebView, registers NovaFetchBridge (networking,
     unchanged) AND the new NovaStateBridge (state), then loads the engine once.
  2. Because NovaStateBridge is registered before loadUrl(), the engine's
     android-native-bridge.ts detects it (isNativeHostPresent()) and:
       - tells browser-window.ts to mount with hideChromeUI: true (its own
         address bar / tab strip DOM is hidden, content rendering untouched)
       - installs window.novaNative = { navigate, back, forward, reload,
         stop, createTab, closeTab, activateTab, getState }
       - pushes a JSON ChromeStateSnapshot to NovaStateBridge.onStateChanged()
         on every tab/nav change (including loading start/end, so the
         Compose address-bar spinner stays accurate)
  3. BrowserViewModel.applySnapshot() parses that JSON and replaces its tab
     list; Compose recomposes AddressBar/TabsBar from it.
  4. User taps in Compose chrome -> BrowserViewModel method -> 
     webView.evaluateJavascript("window.novaNative.X(...)") -> engine acts ->
     pushes a fresh snapshot back. One-way data flow, engine is the source
     of truth throughout.

BUILD & VERIFY (from E:\nova_1 in PowerShell)
  npx tsc --noEmit                              (expect 0 errors)
  npx vitest run tests/android-native-bridge.test.ts   (expect 13 passed)
  npm run build:android                         (web build + asset copy +
                                                  the actual Gradle/APK build,
                                                  which only works on your
                                                  machine, not in my sandbox)

  Delete these two now-unused items after copying:
    android/app/src/main/java/com/nova/browser/webview/  (old per-tab WebView, deleted composable)

KNOWN GAPS (not done — flagging honestly rather than silently skipping)
  - Bookmarks/history are still native-local only (BrowserViewModel), not
    synced with the engine's own IBookmarkService/IHistoryService. Works,
    but a bookmark made on desktop won't appear on Android or vice versa.
  - I could not compile the Kotlin — no Gradle/Android SDK access in this
    sandbox. Read through NovaStateBridge.kt, BrowserViewModel.kt,
    EngineWebView.kt, BrowserScreen.kt, and MainActivity.kt once before
    building; if `gradlew assembleDebug` reports an error, paste it back to
    me and I'll fix it from the message alone.
