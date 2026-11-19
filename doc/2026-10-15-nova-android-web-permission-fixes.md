# Nova Android — Permission, External-Link & Release-Debugging Fixes (v1.1)

**Date:** 2026-10-15
**Session:** "keep improving the nova app" (Nova only; MiniWeb is out of scope from now on). Continues `2026-10-14-android-apps-trim-and-fixes.md`.
**Status:** Completed in two rounds (build + unit tests; not run on a device, since none was attached)

---

## Summary

Size is close to the floor: classes.dex is almost all Compose, and the engine JS is already minified. So this round went to correctness. It fixed two broken page-permission flows: geolocation never worked, and a camera + mic request silently lost the mic. It also removed a dead Cordova config file.

## Root Causes

### 1. Geolocation could never return a position
**File:** `android/app/src/main/java/com/nova/browser/ui/components/EngineWebView.kt`
**Problem:** `onGeolocationPermissionsShowPrompt` auto-granted the origin (`callback.invoke(origin, true, false)`). But the app never requested `ACCESS_FINE_LOCATION`/`ACCESS_COARSE_LOCATION` at runtime, even though the manifest declares them. WebView only delivers a position when the app itself holds that permission, so every page's `navigator.geolocation` call failed without a message.
**Fix:** The prompt now goes through the ViewModel, which asks for the location permissions; there's no dialog if they're already held. The WebView is granted only if at least one is allowed:
```kotlin
fun onGeolocationRequested(origin: String, callback: GeolocationPermissions.Callback) {
    val perms = arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION)
    ask(PermissionAsk(perms) { result -> callback.invoke(origin, result.values.any { it }, false) })
}
```

### 2. Camera + mic requests (video calls) only asked for the camera
**File:** `android/app/src/main/java/com/nova/browser/BrowserViewModel.kt`, `ui/BrowserScreen.kt`
**Problem:** `androidPermissionFor()` returned a single permission. For a request with both `VIDEO_CAPTURE` and `AUDIO_CAPTURE` it returned `CAMERA` only, and the result then did `request.grant(request.resources)`, granting **both**. The page got an audio track the app had no `RECORD_AUDIO` permission for, so the mic didn't work. A second request arriving while one was pending also overwrote the first, which then never resolved and left the page's promise hanging.
**Fix:** `RequestPermission` → `RequestMultiplePermissions`. Every needed permission is asked in one dialog, and only the resources whose permission was granted reach the page:
```kotlin
internal fun grantableResources(resources: Array<String>, granted: Map<String, Boolean>): Array<String> =
    resources.filter { r -> WEB_RESOURCE_PERMISSIONS[r]?.let { granted[it] == true } ?: true }.toTypedArray()
```
A superseded ask now resolves as denied instead of hanging.

## Trimmed
- `android/app/src/main/res/xml/config.xml`: a Cordova `<widget>` leftover that nothing references. Resource shrinking had already been stripping it from the APK, so the APK size is unchanged at 1,425,144 B.

## Files Modified
| File | Change |
|------|--------|
| `android/app/src/main/java/com/nova/browser/BrowserViewModel.kt` | `PermissionAsk` model replaces single-permission `permissionRequest`; `onGeolocationRequested`; `grantableResources` + `WEB_RESOURCE_PERMISSIONS` |
| `android/app/src/main/java/com/nova/browser/ui/components/EngineWebView.kt` | both permission callbacks route through the ViewModel |
| `android/app/src/main/java/com/nova/browser/ui/BrowserScreen.kt` | `RequestMultiplePermissions` launcher |

## Files Deleted
| File | Reason |
|------|--------|
| `android/app/src/main/res/xml/config.xml` | Dead Cordova config |

## Files Created
| File | Purpose |
|------|--------|
| `android/app/src/test/java/com/nova/browser/WebPermissionTest.kt` | 3 tests: both granted → both resources; mic denied → only video; superseded ask → nothing permission-gated |
| `doc/2026-10-15-nova-android-web-permission-fixes.md` | This changelog |

## Test Results
```
cd android && gradlew.bat --no-daemon :app:testDebugUnitTest :app:assembleRelease
first run: e: BrowserViewModel.kt:165:30 Reference has a nullable type ... -> fixed (?.onResult?.invoke)
BUILD SUCCESSFUL in 3m 46s   (0 warnings)
com.nova.browser.UrlInputResolverTest  tests 18 fail 0 err 0
com.nova.browser.WebPermissionTest     tests 3  fail 0 err 0
apksigner verify --min-sdk-version 26 Nova-release.apk -> OK (1,425,144 B)
```

## Verification Steps
- Unit-tested the resource filter, which is the logic that decides what a page receives.
- Built release with R8 (0 warnings) and verified the debug-signed APK.
- **Outstanding (needs a device):** open a page that calls `navigator.geolocation.getCurrentPosition` and confirm the location dialog appears and a position comes back. Start a camera + mic `getUserMedia` call, deny the mic, and confirm video still works without audio.

---

## Round 2 — "keep improving the nova app and note the changes"

### Root causes fixed
#### 3. Links tapped in other apps were ignored
**File:** `android/app/src/main/java/com/nova/browser/MainActivity.kt`, `BrowserViewModel.kt`
**Problem:** The manifest registers Nova for `ACTION_VIEW` http/https links, so Android offers Nova as a browser. But `MainActivity` never read `intent.data` in `onCreate`, and with `launchMode="singleTask"` it never overrode `onNewIntent`. Choosing Nova for a link just opened Nova at its home page. A link that did reach the ViewModel on a cold start would also have been dropped, because `callEngine()` is a no-op until the engine has booted (`window.novaNative && ...`).
**Fix:** `onCreate` (first launch only) and `onNewIntent` both call `openLinkFrom(intent)`. The ViewModel holds the URL until the engine's first state snapshot, then opens it in a new tab:
```kotlin
fun openExternalLink(url: String) {
    if (engineReady) openInNewTab(url) else pendingExternalUrl = url
}
// end of applySnapshot():
engineReady = true
pendingExternalUrl?.let { pendingExternalUrl = null; openInNewTab(it) }
```
`releaseWebView()` resets `engineReady`. Only `http`/`https` URLs are accepted (`isWebLink`), because explicit intents can carry any scheme (`javascript:`, `file:`, `intent:`).

#### 4. WebView remote debugging was enabled in release builds
**File:** `android/app/src/main/java/com/nova/browser/MainActivity.kt`
**Problem:** `WebView.setWebContentsDebuggingEnabled(true)` ran unconditionally. Anyone with USB access to a phone running the shipped app could attach Chrome DevTools and read every page, cookie, and form field, including incognito tabs.
**Fix:** Deleted the line. Android already enables WebView debugging automatically for debuggable apps, so the debug APK (used by `npm run android:smoke-test`) is unaffected. Verified: `aapt2 dump badging` reports `application-debuggable` for the debug APK only (count 1 vs 0), and the call is gone from the R8 mapping.

### Version bump
`versionCode 1 → 2`, `versionName "1.0" → "1.1"`, so the phone treats this APK as an update and Settings → Apps → Nova shows which build is installed.

### Round 2 files
| File | Change |
|------|--------|
| `android/app/src/main/java/com/nova/browser/MainActivity.kt` | handles `ACTION_VIEW` in `onCreate` + `onNewIntent`; `isWebLink()`; removed unconditional WebView debugging |
| `android/app/src/main/java/com/nova/browser/BrowserViewModel.kt` | `openExternalLink` + engine-ready queue; reset in `releaseWebView` |
| `android/app/build.gradle` | version 1.1 (code 2) |
| `android/app/src/test/java/com/nova/browser/ExternalLinkTest.kt` | **new**: accepts http/https (any case); rejects `javascript:`, `file:`, `intent:`, and bare hosts |

### Round 2 test results
```
cd android && gradlew.bat --no-daemon :app:testDebugUnitTest :app:assembleRelease
BUILD SUCCESSFUL in 4m 13s   (0 warnings)
com.nova.browser.ExternalLinkTest     tests 1  fail 0 err 0
com.nova.browser.UrlInputResolverTest tests 18 fail 0 err 0
com.nova.browser.WebPermissionTest    tests 3  fail 0 err 0
after version bump: BUILD SUCCESSFUL in 1m 12s
aapt2 dump badging Nova-release.apk -> package: name='com.nova.browser' versionCode='2' versionName='1.1'; debuggable: 0
apksigner verify --min-sdk-version 26 -> OK (1,429,240 B)
```
**Outstanding (needs a device):** tap a link in another app (Messages or Gmail) → choose Nova → the page opens in a new tab. Test once with Nova closed (cold start) and once with it already open.

---

## What's new in Nova 1.1 (user-facing)
- Links opened from other apps now load in Nova, in a new tab.
- Websites can get your location, after Android's normal permission prompt.
- Video calls get both camera and microphone. Deny the mic and video still works.
- A page whose permission request was replaced by a newer one gets a clean "denied" instead of hanging.
- Security: the shipped app can no longer be inspected over USB debugging.
- (From 2026-10-14) Current engine with CSP/CORS/secure-context enforcement, correct light/dark launch screen, and an APK of ~1.4 MB, down from ~20 MB.
