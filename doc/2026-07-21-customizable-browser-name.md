# Customizable Browser Name

**Date:** 2026-07-21
**Session:** Made browser name configurable across all UI surfaces via BrowserName service
**Status:** Completed

---

## Summary
Replaced all hardcoded "Nova Browser" / "Nova" strings with a centralized `BrowserName` service backed by settings persistence. Users can customize the browser name in Settings > Appearance > Browser name. The name propagates to: window title, new tab page logo, search results footer, shield tooltips, and special page headings.

## Root Causes

### 1. Browser name hardcoded across ~12 files
**Files:** `app-shell.ts`, `content-renderer.ts`, `status-bar.view.ts`, `toolbar.view.ts`, `browser-window.ts`
**Problem:** "Nova Browser" was hardcoded in window title, new tab logo, search footer, shield tooltips, and special pages with no centralized constant or customization mechanism.
**Fix:** Created `BrowserName` service with settings-backed persistence and change notification. Added `browserName` field to `AppConfig` with `BROWSER_NAME` env var support.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/config/browser-name.ts` | **NEW** — `BrowserName` service with settings persistence, change notification, derived values (title, user-agent, brand, logo HTML) |
| `src/ui/pages/settings-page.ts` | Added "Browser name" text setting in Appearance section |
| `src/ui/pages/browser-window.ts` | Added `setBrowserName()` setter, wired brand name to content renderer and document title, replaced hardcoded "Nova Browser" in special pages |
| `src/ui/components/content-renderer/content-renderer.ts` | Added `setBrandName()` method, replaced hardcoded brand in new tab logo and search footer |
| `src/ui/components/toolbar/toolbar.view.ts` | Added `brandName` config field, replaced hardcoded "Nova Shield" tooltip |
| `src/ui/components/status-bar/status-bar.view.ts` | Added `brandName` config field, replaced hardcoded "Nova Shield" tooltips |
| `src/app/main.ts` | Added `BrowserName` token and registration, `BROWSER_NAME` env var loading, wired into BrowserWindowPage |
| `src/app/app-shell.ts` | Added `browserName` to `AppConfig`, used in window title, fixed default user-agent |

## Test Results
```
Test Files  1 failed | 89 passed (91)
Tests       27 failed | 4062 passed (4145)
```
No regressions — same pre-existing OOM failure in `bytecode-vm.test.ts`.
