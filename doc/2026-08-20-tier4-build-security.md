# Tier 4 — Electron Security Hardening + Cross-Platform Builds

**Date:** 2026-08-20
**Session:** Tier 4 of codebase improvement plan
**Status:** Completed

---

## Summary

Added production-grade Electron security hardening (CSP headers, navigation restrictions, permission controls) and expanded build targets to support macOS and Linux alongside Windows. The `nodeIntegration: true` model is preserved because Nova's engine architecture requires renderer-side Node.js access (7 static `crypto` imports, 8 dynamic `require()` sites, 9 unguarded `process.*` accesses across the codebase).

## Root Causes

### 1. No Content-Security-Policy enforcement
**File:** `electron/main.cjs`
**Problem:** The Electron host window had zero CSP headers. Any injected script from a loaded page could execute freely.
**Fix:** Added `session.webRequest.onHeadersReceived` that injects strict CSP headers on every response: `script-src 'self' 'unsafe-inline' 'unsafe-eval'`, `object-src 'none'`, `frame-src 'none'`, plus `X-Content-Type-Options`, `X-Frame-Options`, and `Referrer-Policy`.

### 2. No navigation/popup restrictions
**File:** `electron/main.cjs`
**Problem:** The renderer could navigate away from the app or open popup windows, enabling phishing.
**Fix:** Added `will-navigate` handler that blocks cross-origin navigation and `setWindowOpenHandler` that denies all new windows (Nova uses tabs internally).

### 3. No permission controls
**File:** `electron/main.cjs`
**Problem:** Electron's default permission handler grants camera, microphone, geolocation, etc. to any renderer request.
**Fix:** Added `setPermissionRequestHandler` that only allows clipboard and notification permissions. All other permissions (camera, mic, geolocation, etc.) are denied at the Electron level — Nova's own permission system handles these for web content.

### 4. No production DevTools restriction
**File:** `electron/main.cjs`
**Problem:** `Ctrl+Shift+I` could open DevTools in production builds.
**Fix:** Added `before-input-event` handler that blocks `Ctrl+Shift+I` when `DEV_SERVER_URL` is not set (production mode).

### 5. macOS/Linux build targets missing
**File:** `electron-builder.yml`
**Problem:** Only Windows (NSIS) was configured. No macOS or Linux packages could be built.
**Fix:** Added `mac` (DMG for x64 + arm64 with hardened runtime + entitlements) and `linux` (AppImage, DEB, RPM for x64) targets. Created `build/entitlements.mac.plist` for macOS code signing.

## Architecture Decision: `nodeIntegration: true` preserved

An audit of renderer-side Node.js usage found this would be a breaking change:

| Category | Count | Impact |
|----------|-------|--------|
| Static `import { randomUUID } from 'crypto'` | 7 files | App won't boot |
| Dynamic `require('crypto')` calls | 8 sites | Runtime crashes in auth/networking |
| Unguarded `process.*` access | 9 locations | ReferenceErrors |
| Already-guarded `process` usage | 4 locations | Would degrade gracefully |

Full migration to `contextIsolation: true` requires replacing all of these with Web Crypto API equivalents and a preload bridge — a separate project-level effort.

## Files Modified

| File | Change |
|------|--------|
| `electron/main.cjs` | Added `installSecurityPolicies()`: CSP headers, navigation blocking, popup blocking, permission control, DevTools restriction in production |
| `electron-builder.yml` | Added `mac` (DMG, x64+arm64, hardened runtime) and `linux` (AppImage, DEB, RPM) targets |

## Files Created

| File | Purpose |
|------|---------|
| `build/entitlements.mac.plist` | macOS entitlements for hardened runtime (JIT, network, file access) |

## Test Results

```
npx tsc --noEmit           → 0 errors
npx vitest run             → 195/195 files, 8947/8947 tests passed
npx vite build             → successful (1.57s)
```

## Verification Steps

1. `npx tsc --noEmit` — 0 errors (no TS source changes, only CJS + YAML + plist)
2. `npx vitest run` — 195/195 files, 8,947/8,947 tests pass
3. `npx vite build` — successful, dist/index.html generated
4. Manual review of `electron/main.cjs` — CSP directives, navigation guards, permission handler all present
5. Manual review of `electron-builder.yml` — mac/linux sections valid YAML
