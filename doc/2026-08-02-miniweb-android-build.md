# MiniWeb Android Browser — Build Setup & APK

**Date:** 2026-08-02
**Session:** Made the `mini-browser-android` project buildable end-to-end and produced a working debug APK.
**Status:** Completed

---

## Summary

The `mini-browser-android` project (a native Kotlin + Jetpack Compose browser wrapping Android WebView, named "MiniWeb") had complete source code but could not build: it lacked a Gradle wrapper, a `local.properties` SDK pointer, and had 4 build-blocking issues (missing Material Components dependency, 3 missing Kotlin imports). All were fixed; a debug APK was built, installed on a connected device, and launched successfully.

## Root Causes (bug fixes)

### 1. No Gradle wrapper — project unbuildable from CLI
**File:** `mini-browser-android/gradle/wrapper/` (was empty)
**Problem:** No `gradlew`, `gradlew.bat`, or `gradle-wrapper.jar`/`.properties` existed, so the project could only be opened in Android Studio, never built from the command line.
**Fix:** Copied the wrapper from the repo's existing Capacitor Android project (`E:\nova_1\android\gradle\wrapper\gradle-wrapper.jar`, `gradle-wrapper.properties`, plus `gradlew`/`gradlew.bat`). Wrapper pins `gradle-8.11.1-all.zip`.

### 2. Missing `local.properties`
**File:** `mini-browser-android/local.properties` (new)
**Problem:** No SDK path was configured, so Gradle could not resolve `compileSdk`/`build-tools`.
**Fix:** Added `sdk.dir=C:\\Users\\athar\\AppData\\Local\\Android\\Sdk`.

### 3. XML theme referenced Material3 XML styles not present
**File:** `mini-browser-android/app/src/main/res/values/themes.xml` + `app/build.gradle.kts`
**Problem:** `Theme.MiniWeb` set `parent="Theme.Material3.DayNight.NoActionBar"` and `?attr/colorPrimary`, but the Compose-only project did not depend on `com.google.android.material`, so AAPT resource linking failed (`processDebugResources` → "resource style/Theme.Material3.DayNight.NoActionBar not found").
**Fix:** Added `implementation("com.google.android.material:material:1.12.0")` to `app/build.gradle.kts`. The existing XML theme was then linked successfully.

### 4. Missing Kotlin imports (3 compile errors)
**File:** `mini-browser-android/app/src/main/java/com/miniweb/browser/ui/components/AddressBar.kt`
**Problem:** Used `Modifier.clip(RoundedCornerShape(24.dp))` without importing `androidx.compose.ui.draw.clip`.
**Fix:** Added the import.
**File:** `mini-browser-android/app/src/main/java/com/miniweb/browser/ui/BrowserScreen.kt`
**Problem:** Used `Icons.AutoMirrored.Filled.ArrowBack` / `ArrowForward` without importing them (`Unresolved reference: ArrowBack` / `ArrowForward`).
**Fix:** Added `import androidx.compose.material.icons.automirrored.filled.ArrowBack` and `ArrowForward`.

## Files Modified

| File | Change |
|------|--------|
| `mini-browser-android/app/build.gradle.kts` | Added `com.google.android.material:material:1.12.0` dependency (fixes XML theme resource linking). |
| `mini-browser-android/app/src/main/java/com/miniweb/browser/ui/components/AddressBar.kt` | Added `androidx.compose.ui.draw.clip` import. |
| `mini-browser-android/app/src/main/java/com/miniweb/browser/ui/BrowserScreen.kt` | Added AutoMirrored `ArrowBack`/`ArrowForward` icon imports. |

## Files Created

| File | Purpose |
|------|---------|
| `mini-browser-android/gradle/wrapper/gradle-wrapper.jar` | Gradle wrapper binary (copied from `E:\nova_1\android`). |
| `mini-browser-android/gradle/wrapper/gradle-wrapper.properties` | Wrapper config → `gradle-8.11.1-all.zip`. |
| `mini-browser-android/gradlew` / `gradlew.bat` | Gradle launcher scripts. |
| `mini-browser-android/local.properties` | `sdk.dir` → Android SDK. |

## Build & Runtime Verification

```
# Build (first run downloads Gradle 8.11.1 + dependencies)
.\gradlew.bat --no-daemon :app:assembleDebug
BUILD SUCCESSFUL in 1m 39s
37 actionable tasks: 9 executed, 28 up-to-date

# APK output
mini-browser-android\app\build\outputs\apk\debug\app-debug.apk   19,795,484 bytes

# Install on connected device (adb devices -> KNEUZTEE6TIBAIIV)
adb install -r app-debug.apk        -> Success

# Launch
adb shell am start -n com.miniweb.browser/.MainActivity   -> Started
adb shell "dumpsys activity activities | grep topResumedActivity"
  -> topResumedActivity=ActivityRecord{... com.miniweb.browser/.MainActivity ...}
adb shell "ps -A | grep miniweb" -> com.miniweb.browser process alive

# Crash check
adb logcat -d | grep -E "FATAL EXCEPTION|AndroidRuntime|miniweb"
  -> no crashes; WebView renders frames (BufferQueueProducer fps logged)
```

Runtime checks confirmed: app installs, launches, is the top resumed activity, renders frames, handles back/touch events, survives re-launch after backgrounding — no FATAL/ANR.

## Notes

- Two benign warnings during Kotlin compile: `LibraryBooks` icon deprecated (AutoMirrored version available) and `onTextChange` parameter unused in `AddressBar`. No functional impact.
- APK is `com.miniweb.browser` v1 (versionCode 1), minSdk 26 / target 34, debug-signed.
