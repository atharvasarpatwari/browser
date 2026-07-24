# Nova Browser — Android APK Build Guide

**Date:** 2026-07-23 (updated)
**Status:** Ready

---

## Prerequisites

| Tool | Version | Install Command |
|------|---------|----------------|
| Node.js | 18+ | Download from https://nodejs.org |
| Java JDK | **21+** (required by Capacitor) | `winget install EclipseAdoptium.Temurin.21.JDK` |
| Android SDK | Platform 34+ | Install via command-line tools (see below) |

> **IMPORTANT:** Capacitor requires Java 21. Java 17 will cause `invalid source release: 21` error.

## Install Java JDK 21

```powershell
winget install EclipseAdoptium.Temurin.21.JDK
```

Verify:
```powershell
java -version
# Should show: openjdk version "21.0.11" or later
```

## Install Android SDK (No Android Studio Required)

### 1. Download Command-Line Tools
Download from: https://developer.android.com/studio#command-line-tools-only

### 2. Extract SDK Tools
```powershell
# Create SDK directory
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
New-Item -ItemType Directory -Path "$env:ANDROID_HOME\cmdline-tools" -Force

# Extract downloaded zip to: %LOCALAPPDATA%\Android\Sdk\cmdline-tools\latest\
# (The zip contains a "cmdline-tools" folder — rename it to "latest")
```

### 3. Accept Licenses
```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:PATH"
sdkmanager --licenses
# Press "y" for all prompts
```

### 4. Install Required Packages
```powershell
sdkmanager "platforms;android-34" "build-tools;34.0.0" "platform-tools"
```

> **Note:** Gradle will also auto-download SDK Platform 35 on first build — this is normal.

## Set Environment Variables

### Temporary (current PowerShell session)
```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
$env:PATH = "$env:JAVA_HOME\bin;$env:ANDROID_HOME\cmdline-tools\latest\bin;$env:ANDROID_HOME\platform-tools;$env:PATH"
```

### Permanent (recommended)
1. Open **System Properties → Environment Variables**
2. Add new **User** variables:
   - `JAVA_HOME` = `C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot`
   - `ANDROID_HOME` = `%LOCALAPPDATA%\Android\Sdk`
3. Edit **Path** and add:
   - `%JAVA_HOME%\bin`
   - `%ANDROID_HOME%\cmdline-tools\latest\bin`
   - `%ANDROID_HOME%\platform-tools`

## Build Steps

### Step 1: Build the Web App
```powershell
cd E:\nova_1
npm run build:web
```

### Step 2: Initialize Capacitor Android
```powershell
npx cap add android
```

### Step 3: Sync Web Assets to Android
```powershell
npx cap sync android
```

### Step 4: Build the APK

Set environment (if not permanent):
```powershell
$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"
$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"
```

**Debug APK (no signing required):**
```powershell
cd android
.\gradlew assembleDebug
```
Output: `android\app\build\outputs\apk\debug\app-debug.apk`

**Release APK (requires signing):**
```powershell
cd android
.\gradlew assembleRelease
```

### Step 5: Install on Device

**Via USB (ADB):**
```powershell
# Enable Developer Options + USB Debugging on phone first
adb install android\app\build\outputs\apk\debug\app-debug.apk
```

**Manual:**
Copy `app-debug.apk` to phone → Open file → Install

## Quick Reference

| Command | Description |
|---------|-------------|
| `npm run build:web` | Build the web application |
| `npm run build:android` | Build web + sync to Android |
| `npx cap sync android` | Sync web assets to Android project |
| `npx cap open:android` | Open in Android Studio |
| `adb install [path]` | Install APK on connected device |

## Customization

### Change App Name
Edit `android/app/src/main/res/values/strings.xml`:
```xml
<resources>
    <string name="app_name">Nova Browser</string>
</resources>
```

### Change App Icon
Replace icons in `android/app/src/main/res/` mipmap folders:
- `mipmap-mdpi` (48x48)
- `mipmap-hdpi` (72x72)
- `mipmap-xhdpi` (96x96)
- `mipmap-xxhdpi` (144x144)
- `mipmap-xxxhdpi` (192x192)

### Change Package Name
Edit `capacitor.config.ts`:
```typescript
appId: 'com.yourcompany.novabrowser',
```

## Troubleshooting

| Error | Cause | Solution |
|-------|-------|----------|
| `JAVA_HOME is not set` | Java not installed or JAVA_HOME not set | Install JDK 21: `winget install EclipseAdoptium.Temurin.21.JDK` then set `$env:JAVA_HOME = "C:\Program Files\Eclipse Adoptium\jdk-21.0.11.10-hotspot"` |
| `Android SDK not found` | ANDROID_HOME not set or SDK not installed | Set `$env:ANDROID_HOME = "$env:LOCALAPPDATA\Android\Sdk"` and install SDK via command-line tools |
| `invalid source release: 21` | Java 17 installed, but Capacitor needs Java 21 | Install JDK 21: `winget install EclipseAdoptium.Temurin.21.JDK` |
| `Duplicate class kotlin.collections...` | Kotlin stdlib version conflict between 1.6.21 and 1.8.22 | Already fixed in `app/build.gradle` via `resolutionStrategy.force` — if it recurs, add the `configurations.all` block from the build.gradle |
| `gradlew not found` | Android project not initialized | Run `npx cap add android` first |
| `Build failed` | General build error | Check `java -version` (need 21+), check `$env:ANDROID_HOME` is set, check SDK packages installed |
| `SDK Platform 35 auto-installing` | Gradle auto-downloads missing SDK platforms | This is normal — let it finish |
| `WARNING: Using flatDir should be avoided` | Capacitor uses flatDir for plugins | Harmless warning, can be ignored |
| APK too large | Unoptimized build | Run `npx cap sync --prod` before building |
