# Android APK Build Setup

**Date:** 2026-07-22
**Session:** Wrapped Nova browser as Android APK via Capacitor
**Status:** Completed

---

## Summary

Added Capacitor integration to wrap the Nova browser web UI as a native Android APK. The web app is built with Vite, then Capacitor syncs the output into an Android project that can be compiled into an APK with Gradle.

## Files Created

| File | Purpose |
|------|---------|
| `capacitor.config.ts` | Capacitor config — app ID `com.nova.browser`, web dir `dist`, Android HTTPS scheme |
| `doc/android-apk-build-guide.md` | Full build guide with prerequisites, steps, customization, troubleshooting |

## Files Modified

| File | Change |
|------|--------|
| `package.json` | Added `android`, `build:android`, `open:android` scripts; added `@capacitor/core`, `@capacitor/cli`, `@capacitor/android` deps |

## How It Works

```
src/**/*.ts → Vite build → dist/ → Capacitor sync → android/app/src/main/assets/ → Gradle → APK
```

1. `npm run build:web` compiles TypeScript to `dist/` via Vite
2. `npx cap sync android` copies `dist/` into the Android project's assets
3. `gradlew assembleDebug` compiles the Android project into an APK
4. The APK loads the web assets in a native WebView shell

## Prerequisites (must be installed manually)

| Tool | Version | Install |
|------|---------|---------|
| Java JDK | 17+ | `winget install EclipseAdoptium.Temurin.17.JDK` |
| Android Studio | Latest | https://developer.android.com/studio |
| Android SDK Platform | 34 | Via Android Studio SDK Manager |
| Android Build-Tools | 34 | Via Android Studio SDK Manager |

## Build Commands

```powershell
cd E:\nova_1

# Build web assets
npm run build:web

# First time: create Android project
npx cap add android

# Sync web assets to Android
npx cap sync android

# Build debug APK
cd android
.\gradlew assembleDebug
```

**Output:** `android\app\build\outputs\apk\debug\app-debug.apk`

## Install on Phone

```powershell
# Via ADB (USB debugging enabled)
adb install android\app\build\outputs\apk\debug\app-debug.apk

# Or copy the .apk file to your phone and tap to install
```

## Customization

| What | Where |
|------|-------|
| App name | `android/app/src/main/res/values/strings.xml` |
| App icon | `android/app/src/main/res/mipmap-*/` folders |
| Package ID | `capacitor.config.ts` → `appId` |
| Version | `package.json` → `version` + `android/app/build.gradle` → `versionCode`/`versionName` |

## Test Results

- Web build: 236 modules transformed, 798 KB main bundle
- All existing tests unaffected (4,053+ pass)
