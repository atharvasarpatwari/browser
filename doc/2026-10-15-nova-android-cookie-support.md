# Nova Android — Cookie Support (v1.6)

**Date:** 2026-10-15
**Session:** "keep improving the nova app and note the changes". This is the seventh Nova round today, after `2026-10-15-nova-android-request-body-fixes.md` (v1.5). The emulator is still blocked on the AEHD driver (`emulator -accel-check` → *not installed*).
**Status:** Completed (build + unit tests). Not run on a device.

---

## Summary

Nova on Android never stored or sent cookies, so no site could keep you logged in. All native HTTP now goes through a cookie store. Normal browsing persists in the WebView's `CookieManager`, and incognito gets a separate throwaway jar per session. Version 1.6 (code 7).

## Root Cause

### Cookies were never stored or sent
**Files:** `android/app/src/main/java/com/nova/browser/NovaCookieHandler.kt` (new), `BrowserViewModel.kt`
**Problem:** There were three layers, and none of them handled cookies:
1. Every engine request on Android goes through `NovaFetchBridge`, and every download through `NativeDownloader`. Both use `HttpURLConnection`, which reads and writes cookies only via `java.net.CookieHandler.getDefault()`, and that is `null` unless an app installs one. Nova never did.
2. The engine has a full `CookieJar` (`src/browser/networking/cookie-jar.ts`, with domain/path/SameSite/expiry), but **nothing calls it**. A grep of `src/` finds no caller of `setFromResponse`, `getCookieHeader`, `getForRequest`, or `new CookieJar` outside its own file.
3. Even if the engine wanted to read cookies, the shim rebuilds each response with `new Response(body, { headers })`, and browsers strip `Set-Cookie` from constructed responses.

Result: every `Set-Cookie` was dropped, and no request ever carried a `Cookie` header. Logins, carts, and consent banners reset on every request.

**Fix:** Install one process-wide `CookieHandler` when the ViewModel is created:
```kotlin
private val cookieHandler = NovaCookieHandler(WebkitCookieHandler()).also { java.net.CookieHandler.setDefault(it) }
```
- `WebkitCookieHandler` stores in `android.webkit.CookieManager`, which persists to disk and handles domain/path/expiry/Secure/HttpOnly. `pause()` calls `CookieManager.flush()` so cookies survive the process being killed in the background.
- `NovaCookieHandler` routes to a separate in-memory `java.net.CookieManager` while incognito is on. The engine's `incognito` snapshot flag is mirrored into it in `applySnapshot()`, and the private jar is replaced on every incognito toggle, so private cookies never reach normal browsing and each incognito session starts empty.
- `ponytail:` `CookiePolicy.ACCEPT_ALL` for the private jar, with no third-party cookie blocking. Add a policy if that's wanted.

Because the handler is process-wide, downloads now carry the user's session too, so downloads from logged-in sites work.

## Files Modified
| File | Change |
|------|--------|
| `android/app/src/main/java/com/nova/browser/BrowserViewModel.kt` | installs `NovaCookieHandler`; mirrors `incognito`; `flush()` in `pause()` |
| `android/scripts/emulator-feature-test.mjs` | `/cookie/set` + `/cookie/echo` routes; check #15 (stored → sent → survives HOME + force-stop + relaunch → hidden in incognito → private cookie doesn't leak back) |
| `android/app/build.gradle` | version 1.6 (code 7) |

## Files Created
| File | Purpose |
|------|--------|
| `android/app/src/main/java/com/nova/browser/NovaCookieHandler.kt` | `NovaCookieHandler` (normal vs incognito routing) + `WebkitCookieHandler` (persistent store) |
| `android/app/src/test/java/com/nova/browser/NovaCookieHandlerTest.kt` | login cookie stored and sent; incognito can't see normal cookies, its own don't leak back, and each incognito session starts empty |
| `doc/2026-10-15-nova-android-cookie-support.md` | This changelog |

## Test Results
```
cd android && gradlew.bat --no-daemon :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug
BUILD SUCCESSFUL in 4m 7s   (0 warnings)
unit tests 30 (all pass; +2 NovaCookieHandlerTest)
after version bump: BUILD SUCCESSFUL in 1m 13s
aapt2: versionCode='7' versionName='1.6'; apksigner verify OK
R8 mapping: com.nova.browser.NovaCookieHandler -> j1.m, WebkitCookieHandler -> j1.s (kept; get/put override library methods)
node --check android/scripts/emulator-feature-test.mjs -> OK
```

## Verification Steps
- The unit tests run `NovaCookieHandler` over a real `java.net.CookieManager` (the same class the incognito jar uses).
- **On device / emulator:** `npm run android:feature-test -- --adb <sdk>\platform-tools\adb.exe --only 15`. Also by hand: log into any site, swipe Nova away, reopen it, and you should still be logged in.

## Follow-up (not done here)
The engine's own `CookieJar` and its page-facing `document.cookie` are separate from this native store. Scripts in pages that read `document.cookie` won't see server-set cookies until the engine is wired to a shared store. That's an engine-side change, out of scope for an APK round.

## What's new in Nova 1.6 (user-facing)
- You stay logged in: sites can now set and read cookies, and they persist after closing the app.
- Incognito tabs get their own cookies, which disappear when you leave incognito and never mix with your normal browsing.
- Downloads from sites you're logged into now work.
