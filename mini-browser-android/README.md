# MiniWeb — Android Browser

A native Android browser app built with Kotlin + Jetpack Compose (Material 3),
wrapping the system `WebView` engine with a custom, coral-accented UI: tabs,
address bar with security indicator, bookmarks, and history.

## Open in Android Studio
1. Extract this folder.
2. Android Studio → **Open** → select the `mini-browser-android` folder.
3. Let Gradle sync (needs internet access for dependencies the first time).
4. Run on an emulator or device (min SDK 26 / Android 8.0+).

## Project layout
```
app/src/main/java/com/miniweb/browser/
├── MainActivity.kt              # Entry point, sets Compose content
├── BrowserViewModel.kt          # Tabs, bookmarks, history state
├── model/Tab.kt                 # Tab / Bookmark / HistoryEntry data classes
├── webview/BrowserWebView.kt    # Compose wrapper around android.webkit.WebView
└── ui/
    ├── BrowserScreen.kt         # Top-level screen: tabs + address bar + webview + nav bar
    ├── theme/                   # Color.kt, Type.kt, Theme.kt (light/dark)
    └── components/
        ├── AddressBar.kt        # Pill-shaped URL bar, security icon, progress bar
        ├── TabsBar.kt           # Horizontal scrollable tab strip
        └── BookmarksSheet.kt    # Bottom sheet: bookmarks + history tabs
```

## Features implemented
- Multi-tab browsing (open/close/switch tabs)
- Address bar: autocompletes scheme, falls back to Google search for non-URL input
- Back / forward / reload / stop, wired to hardware back button
- Bookmarks (star toggle) and browsing history, in a bottom sheet
- Loading progress bar + secure/insecure (https/http) indicator
- Light & dark theme (follows system setting) with a distinct coral accent
- Handles `target="_blank"` / `window.open()` by opening a new tab

## Notes / next steps
- WebView settings enable JS + DOM storage; mixed content is compatibility-mode.
- Tabs keep their URL/title/nav-state in `BrowserViewModel`, but only the
  active tab's `WebView` is composed at a time — switching tabs reloads that
  tab's URL (keeps memory low; trivial to change to keep all WebViews alive
  if you'd rather trade memory for instant tab switching).
- No downloads manager / permissions handling for camera-mic (getUserMedia)
  yet — add a `WebChromeClient.onPermissionRequest` override if needed.
