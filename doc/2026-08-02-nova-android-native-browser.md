# Nova Browser — Native Android App (MiniWeb Port)

**Date:** 2026-08-02
**Session:** Convert Capacitor shell into native Kotlin/Compose browser, porting MiniWeb features
**Status:** Completed

---

## Summary

Converted `E:\nova_1\android` from a Capacitor web-shell APK (loading `dist/` web assets in a
`BridgeActivity`) into a native Kotlin/Compose browser app named **Nova Browser** (package
`com.nova.browser`), by porting the proven MiniWeb source. The APK builds, installs, and launches
on the connected device with the system WebView rendering.

## Decisions (user-confirmed)

- **Native app, not web shell:** Nova APK becomes a real native browser like MiniWeb. Nova's
  TypeScript web-engine UI remains in the repo for desktop/web but no longer drives the Android app.
- **Rendering:** System WebView on Android (like MiniWeb), not the custom engine.
- **Branding:** Kept package `com.nova.browser`, applicationId `com.nova.browser`, app label
  "Nova Browser"; MiniWeb's coral theme (`0xFFFF6A4D`) retained as Nova's brand color.

## Root Causes (build blockers found during port)

### 1. Capacitor bridge no longer desired
**File:** `android/app/src/main/java/com/nova/browser/MainActivity.java`
**Problem:** `BridgeActivity` requires `:capacitor-android` project + `assets/public` web assets;
the whole Gradle config (settings.gradle, capacitor.settings.gradle, capacitor-cordova-android-plugins,
variables.gradle, app/build.gradle) was wired to Capacitor.
**Fix:** Rewrote `settings.gradle` to only `include ':app'`, root `build.gradle` with
AGP 8.7.2 + Kotlin 1.9.24 classpath, and `app/build.gradle` to a native Kotlin/Compose app
(compileSdk/targetSdk 34, minSdk 26, Compose BOM 2024.06.00, composeOptions 1.5.14, material 1.12.0).
Deleted Capacitor module dir, `variables.gradle`, `capacitor.settings.gradle`, `capacitor.build.gradle`,
web `assets/`, `res/xml`, `res/layout`, splash drawables, and old `.java`/test files.

### 2. npm scripts would destroy the native app
**File:** `package.json`
**Problem:** `android`, `android:sync`, `build:android`, `build:android:full`, `open:android`
ran `cap sync android`, which regenerates Capacitor files and would overwrite the new native code.
**Fix:** Repointed all Android scripts to direct Gradle (`gradlew.bat assembleDebug` / `installDebug`);
removed `cap`/`cap sync` calls.

## Files Modified

| File | Change |
|------|--------|
| `android/settings.gradle` | Only `include ':app'` (dropped capacitor plugin module) |
| `android/build.gradle` | AGP 8.7.2 + Kotlin 1.9.24 classpath; removed google-services & variables.gradle |
| `android/app/build.gradle` | Rewritten: Kotlin + Compose, namespace/appId `com.nova.browser`, minSdk 26 |
| `android/app/src/main/AndroidManifest.xml` | INTERNET + ACCESS_NETWORK_STATE, `Theme.NovaBrowser`, `singleTask`, VIEW http/https intent-filter; removed FileProvider |
| `android/app/src/main/res/values/styles.xml` | `Theme.NovaBrowser` (parent Material3 DayNight.NoActionBar) |
| `android/app/src/main/res/values/strings.xml` | Only `app_name` = "Nova Browser" |
| `package.json` | Android scripts use Gradle directly; removed all `cap` calls |

## Files Created (ported from `mini-browser-android`, package renamed `com.miniweb.browser` → `com.nova.browser`)

| File | Purpose |
|------|---------|
| `android/app/src/main/java/com/nova/browser/MainActivity.kt` | Compose entry, `NovaBrowserTheme` + `BrowserScreen` |
| `android/app/src/main/java/com/nova/browser/BrowserViewModel.kt` | Tabs/activeTab/bookmarks/history/addressBar state + `resolveInput` |
| `android/app/src/main/java/com/nova/browser/model/Tab.kt` | `Tab`, `Bookmark`, `HistoryEntry` data classes |
| `android/app/src/main/java/com/nova/browser/webview/BrowserWebView.kt` | `WebViewHandle` + `BrowserWebView` (system WebView, JS/domStorage, favicon, new-tab) |
| `android/app/src/main/java/com/nova/browser/ui/BrowserScreen.kt` | Scaffold: TabsBar + AddressBar + bottom bar + LibrarySheet; BackHandler |
| `android/app/src/main/java/com/nova/browser/ui/components/AddressBar.kt` | Address field, secure/loading indicator, reload/stop, bookmark star |
| `android/app/src/main/java/com/nova/browser/ui/components/TabsBar.kt` | LazyRow tab chips + new-tab button |
| `android/app/src/main/java/com/nova/browser/ui/components/BookmarksSheet.kt` | `LibrarySheet` (Bookmarks/History ModalBottomSheet) |
| `android/app/src/main/java/com/nova/browser/ui/theme/Color.kt` | Coral palette (kept from MiniWeb) |
| `android/app/src/main/java/com/nova/browser/ui/theme/Theme.kt` | `NovaBrowserTheme` (dark/light schemes, status/nav bar) |
| `android/app/src/main/java/com/nova/browser/ui/theme/Type.kt` | `NovaBrowserTypography` |

## Test Results

Build (`E:\nova_1\android`, Gradle 8.11.1 wrapper):
```
.\gradlew.bat :app:assembleDebug --no-daemon
BUILD SUCCESSFUL in 5m 35s
37 actionable tasks: 37 executed
```
Warnings only (same as MiniWeb baseline): `Icons.Filled.LibraryBooks` deprecated (use AutoMirrored);
`onTextChange` param unused. Not errors.

Install + launch + verification (`adb` on device `KNEUZTEE6TIBAIIV`):
```
adb install -r app/build/outputs/apk/debug/app-debug.apk   → Success
adb shell am start -W -n com.nova.browser/.MainActivity     → Status: ok, TotalTime: 284, Complete
adb shell dumpsys activity activities → topResumedActivity = com.nova.browser/.MainActivity
adb shell ps -A | grep com.nova.browser → process alive after force-stop + cold start (pid 7446)
adb logcat -d -b crash → no com.nova.browser FATAL (only pre-existing July entries)
adb logcat -d → no "ANR in com.nova.browser", no process-died for nova
dumpsys activity processes → ConnectionRecord: com.nova.browser/org.chromium.content.app.SandboxedProcessService0
  ⇒ system WebView (com.google.android.webview 150.0.7871.181) renderer actively running for the page
```

APK audit (`aapt2 dump badging` + `tar -tf`):
```
package: name='com.nova.browser' versionName='1.0'
application-label:'Nova Browser'
launchable-activity: name='com.nova.browser.MainActivity'
permissions: INTERNET, ACCESS_NETWORK_STATE
size: 20,227,947 bytes
No assets/public, cordova.js, or index.html inside APK (pure native, no Capacitor web bundle)
```

## Verification Steps

1. `gradlew.bat assembleDebug` → BUILD SUCCESSFUL (2 warnings, both carried from MiniWeb).
2. Installed APK on device; launched `com.nova.browser/.MainActivity`.
3. Confirmed top-resumed activity, stable process across force-stop/cold-start, WebView renderer
   sandbox process active, no FATAL/ANR/logcat errors for nova.
4. Confirmed launcher lists the installed app as "Nova Browser" (via launcher view hierarchy dump).
5. Confirmed APK has no Capacitor web assets and only native dex + resources.

## Follow-up: On-Device UI Verification (2026-08-02, same session)

The earlier session could not visually confirm the rendered UI (stuck OS notification shade; no
image input on the model). This was resolved by dismissing the stuck shade (pause Brave media
session via `input keyevent KEYCODE_MEDIA_PAUSE`, then BACK x2), which let `mCurrentFocus` become
`com.nova.browser/.MainActivity`. `uiautomator dump` then returned the app's live accessibility
tree — every UI component is present and rendered:

```
top pkg: com.nova.browser
texts:   Google            → WebView page title (Google default page)
         www.google.com    → AddressBar URL field (displayUrl strip)
desc:    Close tab, New tab            → TabsBar
         Secure, Reload, Bookmark      → AddressBar lock/reload/star
         Back, Forward, Bookmarks & History → BrowserScreen BottomAppBar
class:   android.webkit.WebView        → system WebView node rendering the page
```

Also confirmed via `dumpsys activity processes`: `com.nova.browser/org.chromium.content.app.
SandboxedProcessService0` renderer connections active; `logcat -b crash` shows no `FATAL EXCEPTION`
on 08-02. Screenshot pulled to
`C:\Users\athar\AppData\Local\Temp\opencode\nova_ui_verify.png` (not visually readable by this
model, but the accessibility-tree evidence above is conclusive).

## Follow-up: `android/.gitignore` restore

The Capacitor cleanup had deleted `android/.gitignore`, leaving `android/.gradle/`, `android/build/`,
`android/app/build/`, and `android/local.properties` as untracked (`??`) — a bare `git add .` would
have committed build outputs and the machine-specific SDK path. Restored the file (standard Android
template; dropped Capacitor-only entries: `capacitor-cordova-android-plugins`, `assets/public`,
`capacitor.config.json`, `capacitor.plugins.json`, `res/xml/config.xml`). `git status` after restore:
those four paths no longer appear as untracked.

## Notes

- The device's `NotificationShade` was stuck focused at the OS level during verification (a
  device UI state independent of this app); Nova's window surface was valid and the app was
  top-resumed on launch. Screenshot couldn't be visually inspected (model has no image input),
  so UI was verified via activity/process/window/WebView-renderer evidence instead.
- Capacitor config (`capacitor.config.ts`, `@capacitor/*` deps) remains in the repo but is no
  longer wired into the Android build. Old docs (`2026-07-22-android-apk-setup.md`,
  `2026-07-31-android-apk-build-config.md`) describe the retired Capacitor flow.
