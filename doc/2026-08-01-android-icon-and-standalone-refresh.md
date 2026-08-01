# Android Launcher Icon + Analysis Report Standalone Refresh

**Date:** 2026-08-01
**Session:** Replaced the Nova Android launcher icon with the project logo and refreshed the embedded data snapshot in the standalone analysis report.
**Status:** Completed

---

## Summary
Two tasks: (1) generated all Android launcher icon densities from `logo-image.png` and rebuilt/reinstalled the debug APK on a connected device; (2) regenerated the `EMBEDDED_DATA` snapshot inside `analysis-report/analysis-report-standalone.html` from the live backend so it reflects the current repo state (34 commits, was 29).

## Root Causes (problem → fix)

### 1. Icon source was not web-ready
**File:** `android/app/src/main/res/mipmap-*/` (15 PNGs)
**Problem:** Launcher icons were Capacitor defaults; no logo asset applied.
**Fix:** Resized `logo-image.png` (1254×1254) into every density:
- Legacy icons (`ic_launcher.png`, `ic_launcher_round.png`): 48 / 72 / 96 / 144 / 192 px.
- Adaptive foregrounds (`ic_launcher_foreground.png`): 108 / 162 / 216 / 324 / 432 px with the logo scaled into the 66/108 safe zone — first pass at 0.62 canvas scale (too small), adjusted to 0.707 so the logo's corners touch the circular launcher mask.

Used System.Drawing `HighQualityBicubic` via PowerShell; no alpha/transparency change to the source.

### 2. APK rebuild + install on device
**Problem:** Device needed the new icon.
**Fix:** `gradlew assembleDebug` (BUILD SUCCESSFUL in 36s), `adb install -r` the debug APK, relaunched `com.nova.browser` via monkey. Device: RMX5264 (KNEUZTEE6TIBAIIV).

### 3. Stale embedded snapshot in standalone HTML
**File:** `analysis-report/analysis-report-standalone.html`
**Problem:** `EMBEDDED_DATA` was frozen at 2026-07-31 (29 commits, 3028 files); recent sessions (typecheck cleanup, Android work) were absent from the offline fallback.
**Fix:** Started the Express backend (`analysis-report/backend/server.js`, port 4567), fetched `/stats`, `/branches`, `/activity?days=30`, `/commits?limit=500`, and re-injected the JSON with HTML-entity escaping (`<`,`>`,`&` → `\u003c` etc.) via `C:\Users\athar\AppData\Local\Temp\opencode\rebuild-standalone.js`.

### 4. Newline dropped during injection (caught by verification)
**File:** `analysis-report/analysis-report-standalone.html`
**Problem:** The first injection pass joined `const EMBEDDED_DATA = {...};` and `const API_BASE = ...;` onto one line (250 KB line). Valid JS (`node --check` passed) but not clean.
**Fix:** Split the line at `const API_BASE`, restoring the one-statement-per-line layout.

## Files Modified
| File | Change |
|------|--------|
| android/app/src/main/res/mipmap-{m,h,x,xx,xxx}dpi/ic_launcher.png | Logo at 48–192 px |
| android/app/src/main/res/mipmap-{m,h,x,xx,xxx}dpi/ic_launcher_round.png | Logo at 48–192 px |
| android/app/src/main/res/mipmap-{m,h,x,xx,xxx}dpi/ic_launcher_foreground.png | Logo in adaptive safe zone (0.707 scale) at 108–432 px |
| analysis-report/analysis-report-standalone.html | Refreshed `EMBEDDED_DATA` (34 commits), new fetch timestamp, layout fix |

## Files Created
| File | Purpose |
|------|--------|
| doc/2026-08-01-android-icon-and-standalone-refresh.md | This change log |
| (temp) C:\Users\athar\AppData\Local\Temp\opencode\rebuild-standalone.js | Rebuilds EMBEDDED_DATA from live API |

## Test Results
```
gradlew assembleDebug  → BUILD SUCCESSFUL (36s)
adb install -r app-debug.apk → Success
adb monkey launch com.nova.browser → Events injected: 1
node --check extracted <script> → SCRIPT SYNTAX OK
standalone data shape check:
  stats.totalCommits = 34   currentBranch = main   todayCommits = 0
  branches = [main, remotes/origin/main]
  activity days = 30 (total 34 commits)
  commits = 34
  DATA SHAPE OK  (1 warning: root commit has no files — page handles via optional chaining)
git diff: only timestamp comment + EMBEDDED_DATA + CRLF normalization (3/3 lines)
```

## Verification Steps
1. Device `adb devices -l` showed the phone; APK installed and app launched (logo visible on home screen — visual check by user).
2. Backend started, 4 API endpoints fetched, snapshot re-injected.
3. `node --check` on the extracted inline script → no syntax errors.
4. Parsed the injected JSON and validated every field the page consumes (`stats` cards, `branches`, 30-day `activity`, `commits` with category/status/rootCause/files). Root commit (`bcb68775`, initial "Nova_-Project") legitimately lacks `files` (no parent tree); page code uses `commit.files?.modified?.length` / `commit.files || {}` so it renders fine — identical to live-backend behavior.
5. `git diff` confirmed only the snapshot + timestamp line changed.
6. Backend stopped after capture.
