# Android APK Build and Install Configuration

**Date:** 2026-07-31
**Session:** Configure project for APK build/install
**Status:** Completed

---

## Summary

Added project scripts and documentation to make APK build and install easier for the Nova Browser Capacitor Android project.

## Changes

- Updated `package.json` with convenient Android commands:
  - `npm run android:sync` → builds web assets and syncs to Android
  - `npm run android:assemble` → builds the Android debug APK
  - `npm run android:install` → installs the debug APK on a connected device/emulator
  - `npm run android:run` → full sync + install workflow

## Verification

The repository already includes Capacitor Android wiring and Android Gradle wrappers. These scripts map to existing build steps.

## Files Modified

| File | Change |
|------|--------|
| `package.json` | Added Android build/install helper scripts |
| `doc/2026-07-31-android-apk-build-config.md` | Added configuration summary |
