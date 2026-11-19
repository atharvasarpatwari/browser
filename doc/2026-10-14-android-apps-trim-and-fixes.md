# Android Apps — Dependency Trim, R8 Shrinking & Warning Fixes

**Date:** 2026-10-14
**Session:** "trim the android app and fix them" — trimmed both Android projects (`android/` Nova, `mini-browser-android/` MiniWeb) and fixed every compiler warning plus a latent build break exposed by the trim.
**Status:** Completed (three rounds: trim + fixes, "keep improving the apk", "keep improving it")

---

## Summary

Both apps already built, but shipped unminified release APKs (~20 MB each), carried unused dependencies, a dead Capacitor Gradle file, and 7 compiler warnings. Release builds now run R8 + resource shrinking (Nova release **3.0 MB**, MiniWeb release **2.2 MB**, vs ~20 MB unminified debug), unused deps are gone, and both apps compile with **0 warnings**.

## Root Causes

### 1. Release builds were never shrunk
**Files:** `android/app/build.gradle`, `mini-browser-android/app/build.gradle.kts`
**Problem:** `minifyEnabled false` — every release APK carried all of `material-icons-extended` (thousands of unused icon classes) and the rest of Compose unstripped.
**Fix:**
```groovy
release {
    minifyEnabled true
    shrinkResources true
```
The default `proguard-android-optimize.txt` already keeps `@JavascriptInterface` methods, so no custom rules were needed. Verified against R8's `mapping.txt`: all 7 bridge methods (`fetch`, `abort`, `onStateChanged`, `onBookmarksChanged`, `onHistoryChanged`, `onDownloadRequested`, `onContextMenuRequested`) keep their names. MiniWeb's `proguardFiles` pointed at a `proguard-rules.pro` that doesn't exist, so that reference was dropped.

### 2. MiniWeb only compiled thanks to a transitive dependency
**File:** `mini-browser-android/app/build.gradle.kts`
**Problem:** `BrowserScreen.kt` imports `androidx.lifecycle.viewmodel.compose.viewModel`, but the project never declared `lifecycle-viewmodel-compose`. It came in through `navigation-compose`, which the app doesn't use. Removing the unused dependency broke the build (`Unresolved reference: compose`).
**Fix:** Declared it directly: `implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.8.4")`. Nova already declared it.

### 3. Compiler warnings (7 across both apps)
- Deprecated `Icons.Filled.LibraryBooks` / `OpenInNew` → `Icons.AutoMirrored.Filled.*` (RTL-correct).
- `AddressBar(onTextChange)` was never read. The bar edits a local `draft` and only reports on submit. Removed the parameter and its call-site arguments in both apps.
- Nova `EngineWebView.kt` overrode the deprecated `onReceivedError(WebView, Int, String, String)` → replaced with the `WebResourceRequest`/`WebResourceError` overload (API 23+, minSdk is 26).

## Trimmed
| Item | App | Why it's safe |
|------|-----|-------|
| `androidx.navigation:navigation-compose` | both | no navigation imports |
| `androidx.datastore:datastore-preferences` | both | no datastore imports |
| `androidx.compose.ui:ui-tooling-preview` | both | no `@Preview` composables (`ui-tooling` kept as `debugImplementation`) |
| `android/app/capacitor.build.gradle` | Nova | never applied. It referenced the already-deleted `capacitor-cordova-android-plugins/` |

## Files Modified
| File | Change |
|------|--------|
| `android/app/build.gradle` | R8 + shrinkResources on release; removed 3 unused deps |
| `android/app/src/main/java/com/nova/browser/ui/BrowserScreen.kt` | AutoMirrored `LibraryBooks`; dropped `onTextChange` arg |
| `android/app/src/main/java/com/nova/browser/ui/components/AddressBar.kt` | Removed unused `onTextChange` param |
| `android/app/src/main/java/com/nova/browser/ui/components/ContextMenuSheet.kt` | AutoMirrored `OpenInNew` |
| `android/app/src/main/java/com/nova/browser/ui/components/EngineWebView.kt` | Non-deprecated `onReceivedError` overload |
| `mini-browser-android/app/build.gradle.kts` | R8 + shrinkResources; removed 3 unused deps; added explicit `lifecycle-viewmodel-compose`; dropped missing proguard file ref |
| `mini-browser-android/app/src/main/java/com/miniweb/browser/ui/BrowserScreen.kt` | AutoMirrored `LibraryBooks`; dropped `onTextChange` arg |
| `mini-browser-android/app/src/main/java/com/miniweb/browser/ui/components/AddressBar.kt` | Removed unused `onTextChange` param |

## Files Deleted
| File | Reason |
|------|--------|
| `android/app/capacitor.build.gradle` | Dead Capacitor leftover |

## Files Created
| File | Purpose |
|------|--------|
| `doc/2026-10-14-android-apps-trim-and-fixes.md` | This changelog |

## Test Results
```
# Nova (android/)
gradlew.bat --no-daemon :app:assembleDebug :app:assembleRelease :app:testDebugUnitTest
BUILD SUCCESSFUL in 5m 48s   (0 Kotlin warnings; was 5)
app-debug.apk             20,802,916 B
app-release-unsigned.apk   2,987,977 B   (R8 + shrinkResources)

# MiniWeb (mini-browser-android/)
gradlew.bat --no-daemon :app:assembleDebug :app:assembleRelease
first run: e: BrowserScreen.kt:12:37 Unresolved reference: compose  -> root cause 2, fixed
BUILD SUCCESSFUL in 6m 21s   (0 Kotlin warnings; was 2)
app-debug.apk             19,793,130 B
app-release-unsigned.apk   2,204,496 B

# R8 bridge check (Nova mapping.txt): kept abort, fetch, onBookmarksChanged,
# onContextMenuRequested, onDownloadRequested, onHistoryChanged, onStateChanged
```

## Verification Steps
- Built debug and release for both apps from clean Kotlin compilation and confirmed zero `w:`/`e:` lines.
- Ran Nova's `UrlInputResolverTest` unit tests and they passed.
- Checked R8's `mapping.txt` to confirm the `@JavascriptInterface` method names survive minification.
- **Not done:** no on-device run. `adb devices` listed no attached device this session. Before shipping, sign the release APK and run `npm run android:smoke-test` against it. R8 is the one change here that can only fail at runtime.

---

## Round 2 — "keep improving the apk file"

An APK breakdown showed the remaining weight was `resources.arsc` (725 KB, mostly Material/AppCompat translations), ~350 KB of launcher PNGs, and the v1 JAR signature (~55 KB).

### Root causes fixed
#### 4. Nova launch-frame theme was day/night swapped
**Files:** `android/app/src/main/res/values{,-night}/styles.xml`
**Problem:** `values/` (light mode) set the window to `#10111A` with dark status-bar icons off, and `values-night/` set `#F6F6F2`. Compose's `Theme.kt` uses `SpaceBackground #10111A` for **dark** and `PaperBackground #F6F6F2` for **light**. Every cold start flashed the opposite color before Compose drew.
**Fix:** Swapped them: light `#F6F6F2` + `windowLightStatusBar=true`, night `#10111A` + `false`. Confirmed with `aapt2 dump resources` (default + `(night)` entries).

#### 5. MiniWeb launch frame always white (white flash in dark mode)
**Files:** `mini-browser-android/app/src/main/res/values/themes.xml`, new `values-night/themes.xml`
**Problem:** `windowBackground` was hard-coded `@android:color/white` with no night variant. The status bar used `?attr/colorPrimary` (the Material3 default purple), which Compose overrides immediately anyway.
**Fix:** The light window is `#FBFAF8` and night is `#121214`, matching `PaperBackground`/`InkBackground` in `Theme.kt`.

### Trims
| Change | Why safe |
|---|---|
| Dropped `com.google.android.material` from both apps; XML theme parents → platform `android:Theme.Material.{Light.}NoActionBar` | The XML theme only styles the window before Compose draws, and both activities are `ComponentActivity` |
| `resourceConfigurations += ['en']` in both | The apps' own strings are English-only, and this drops bundled library translations |
| Deleted Nova's 10 legacy `ic_launcher.png`/`ic_launcher_round.png` | minSdk 26 always resolves `mipmap-anydpi-v26` adaptive icons |
| Nova `ic_launcher_foreground` PNG → **lossless** WebP (Pillow, `method=6`) | ~49% smaller per density, pixel-identical |
| Signed with `--v1-signing-enabled false` | v1 JAR signing is only needed below API 24 |

### Sizes (signed release APK)
| App | Round 1 | Round 2 |
|---|---|---|
| Nova | 3,052,736 B | **1,438,168 B** (−53%) |
| MiniWeb | 2,262,919 B | **878,282 B** (−61%) |

Nova's remaining weight is `classes.dex` 886 KB (Compose plus icons kept by R8), `assets` 369 KB (the engine JS bundle), and `res` 133 KB (icon WebPs). `resources.arsc` went from 725 KB to 15 KB.

### Round 2 test results
```
android/: gradlew.bat --no-daemon :app:assembleRelease :app:testDebugUnitTest  -> BUILD SUCCESSFUL in 4m 44s (0 warnings)
mini-browser-android/: gradlew.bat --no-daemon :app:assembleRelease           -> BUILD SUCCESSFUL in 3m 32s (0 warnings)
apksigner verify --min-sdk-version 26  -> OK for both
aapt2 dump badging: icon resolves (res/*.xml adaptive icon) for every density in both apps
aapt2 dump resources: Theme.NovaBrowser default=#fff6f6f2 lightStatus=true, (night)=#ff10111a lightStatus=false
adb devices -> no device attached (on-device check still outstanding)
```

### Round 2 files
| File | Change |
|---|---|
| `android/app/build.gradle` | removed `material`; `resourceConfigurations += ['en']` |
| `android/app/src/main/res/values/styles.xml`, `values-night/styles.xml` | day/night swap fix; platform parent |
| `android/app/src/main/res/mipmap-*dpi/ic_launcher{,_round}.png` (10) | deleted |
| `android/app/src/main/res/mipmap-*dpi/ic_launcher_foreground.png` (5) → `.webp` (5) | lossless WebP |
| `mini-browser-android/app/build.gradle.kts` | removed `material`; `resourceConfigurations += listOf("en")` |
| `mini-browser-android/app/src/main/res/values/themes.xml` | themed light window; platform parent |
| `mini-browser-android/app/src/main/res/values-night/themes.xml` | **new**: night window |

---

## Round 3 — "keep improving it"

### Root cause fixed
#### 6. Nova shipped a month-old engine bundle
**Files:** `android/app/src/main/assets/**`
**Problem:** The bundled engine was last synced in commit `618e8f5` (2026-09-11). Since then, 14 engine/UI source files had changed (3 commits): security enforcement wiring (`secure-context.ts`, `web-apis-permissions.ts`), the `page-renderer.ts`/`fetch-api.ts`/`dns-resolver.ts` fixes, and the address-bar/tab-strip/toolbar view updates. None of that was in the APK.
**Fix:** Ran the same steps as `npm run build:android`'s web half: `npx vite build` → `node android/scripts/copy-web.mjs`. The bundle is already minified (1.36 MB raw, 320 KB gzip), so this round brought no size win here, only correctness.

### Trim
`packaging.resources.excludes += ['DebugProbesKt.bin', 'kotlin-tooling-metadata.json', 'kotlin/**']` in both apps. These are coroutine-debugger and kotlin-reflect metadata, and neither app uses either.

### Sizes (signed release APK)
| App | Round 2 | Round 3 |
|---|---|---|
| Nova | 1,438,168 B | **1,425,144 B** (now with the current engine) |
| MiniWeb | 878,282 B | **865,258 B** |

### Round 3 test results
```
npx vite build                                   -> built in 6.09s (main-B2Rm1TMK.js 1,361.28 kB, gzip 319.78 kB)
node android/scripts/copy-web.mjs                -> Bridge injected; assets copied
npx vitest run tests/android-native-bridge.test.ts -> 1 file, 37/37 passed
android/: gradlew.bat :app:assembleRelease :app:testDebugUnitTest -> BUILD SUCCESSFUL in 3m 44s (0 warnings)
mini-browser-android/: gradlew.bat :app:assembleRelease          -> BUILD SUCCESSFUL in 3m 23s (0 warnings)
apksigner verify --min-sdk-version 26 -> OK for both

Headless boot check (Playwright Chromium; assets served at https://appassets.androidplatform.net/
exactly like WebViewAssetLoader; stub window.NovaStateBridge injected before load, as EngineWebView does):
  novaNative installed; tabs 1 -> 2 ; homeUrl about:newtab ; bridge pushes onStateChanged,onBookmarksChanged,onHistoryChanged
  page errors: none
```
`homeUrl` is now `about:newtab`, where the 2026-09-06 device run showed `about:blank`. That comes from the new-tab-page work now included in the bundle. It's an expected change.

### Round 3 files
| File | Change |
|---|---|
| `android/app/src/main/assets/index.html` | points at the new `main-B2Rm1TMK.js` |
| `android/app/src/main/assets/assets/main-*.js`, `png-*.js`, `process-manager-*.js` | replaced with the current build (new content hashes) |
| `android/app/build.gradle`, `mini-browser-android/app/build.gradle.kts` | `packaging` excludes |
