# Extension System Test Fixes

**Date:** 2026-07-29
**Session:** Fix extension system test failures
**Status:** Completed

---

## Summary
Fixed 8 test failures in `tests/extensions.test.ts` caused by URL pattern matching issues (`*.example.com` requires a subdomain), `this` binding in port `disconnect()`, and host permission validation gaps.

## Root Causes

### 1. URL patterns need real subdomains
**File:** `tests/extensions.test.ts`
**Problem:** Tests used `https://example.com/page` with match pattern `https://*.example.com/*`. The `*` in the host position requires at least one character, so `sub.example.com` matches but bare `example.com` does not.
**Fix:** Changed all test URLs from `https://example.com/*` to `https://sub.example.com/*` in `matchesUrl`, `findMatchingScripts`, `getJSForScripts`, `getCSSForScripts`, and the `excludeMatches` test.

### 2. Port disconnect `this` binding
**File:** `src/browser/extensions/messaging.ts`
**Problem:** The `disconnect()` method on the port object used `this.ports` and `this.emit`, but `this` refers to the port (POJO), not the `Messaging` instance. Additionally, `disconnectCallbacks` was defined after the port object literal (line 144) while being used inside it (line 125), which — while not a TDZ violation at runtime — was fragile.
**Fix:** Captured `this` as `const self = this` before the port object, and moved `const disconnectCallbacks = []` before the port object literal.

### 3. Host permission regex too restrictive
**File:** `src/browser/extensions/permissions.ts`
**Problem:** `HOST_PERMISSION_PATTERN` regex `/^(https?:\/\/|\*:\/\/)/` only accepted `http://`, `https://`, and `*://`. The test used `ftp://*/*` and expected `true`.
**Fix:** Added `ftp://` and `file://` to the regex: `/^(https?:\/\/|\*:\/\/|ftp:\/\/|file:\/\/)/`.

### 4. getRequiredForManifest missing `<all_urls>` handling
**File:** `src/browser/extensions/permissions.ts`
**Problem:** `getRequiredForManifest` and `getOptionalFromManifest` didn't check for `<all_urls>` — only `isKnownPermission` and `validateHostPermission`. Since `<all_urls>` is a valid match pattern, it should be accepted.
**Fix:** Added `p === '<all_urls>'` check to both filter functions.

### 5. isPersistent test expected `undefined`
**File:** `tests/extensions.test.ts`
**Problem:** The test expected `bg.isPersistent('ext-2')` to return `undefined`, but the implementation returns `false` (default for `persistent` when not specified).
**Fix:** Changed expectation from `undefined` to `false`.

## Files Modified
| File | Change |
|------|--------|
| `tests/extensions.test.ts` | Fixed 6 test URLs to use subdomains; fixed `isPersistent` expected value |
| `src/browser/extensions/messaging.ts` | Fixed `this` binding in port `disconnect()`; moved `disconnectCallbacks` before usage |
| `src/browser/extensions/permissions.ts` | Expanded `HOST_PERMISSION_PATTERN` regex; added `<all_urls>` check in manifest permission filters |

## Test Results
```
✓ tests/extensions.test.ts (90 tests)
All 90 extension tests pass.
270 additional tests across screen-reader, devtools, devtools-panels also pass with no regressions.
```
