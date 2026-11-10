# Nova Android 2.05–2.06: The Second Style Pass Is Incremental; Ad Hiding Survives Scripts; Typed Hosts Try HTTPS Then HTTP

**Date:** 2026-11-10
**Session:** "keep improving the nova app and update analytics.html and test on device"
**Status:** Completed. Tested on the OnePlus Pad Go (OPD2305, Android 14, screen on and unlocked).

---

## Summary
The first real tablet timing of CNN (2.04, screen on) was ~44 s of page rendering. Its phase breakdown named the next target: a **second full style pass after the scripts took 12 s**. 2.05 makes it incremental. Along the way:
- the ad blocker's element-hiding rules were being dropped by that pass on any page with scripts (#2);
- the first pass had the page's own `<style>` rules before its linked sheets (#3).

2.06 fixes a usability bug found in the device check: a site without HTTPS typed by name could not be opened (#4).

| CNN | 2.04 | 2.05 |
|---|---|---|
| Tablet, `style2` phase (second style pass) | 12.1 s | **16 ms** (second load; the first, restored-tab load still took a full pass, 11.9 s) |
| Tablet, phases of the intent-opened load | ~53 s summed | ~34 s summed |
| Offline (desktop CPU), with CNN's scripts | 42.6 s | **27.5 s** |

## Root Causes

### 1. The whole page was restyled again after the scripts ran
**File:** `src/browser/engine/page-renderer.ts` (`render`)
**Problem:** `style2` = 12 s on CNN on the tablet (12.1 s on 2.04, 11.9 s on a 2.05 full-pass load): the full style pass ran a second time for every page with scripts, rebuilding the stylesheet and its rule index too.
**Root cause:** after the scripts, the renderer re-read the page's `<style>` elements and restyled every element, whatever the scripts had changed.
**Fix:**
- A cheap signature of the `<style>` text (element count, length and a hash) and a count of removed nodes (`DomTree.removalCount`) are taken before and after the scripts.
- If neither changed, only what the scripts touched is restyled: new and changed elements, plus the siblings after them, since a new node can change `+`, `~` and `:nth-child` matches.
- The parsed stylesheet and its rule index are reused (`_stylesheetRules` tracks which rules they were built from).
- If most of the page is dirty (over 40%, as on CNN's initial script load), the full pass runs instead, still reusing the stylesheet, because restyling element by element is slower per element.
- Anything else (changed styles, removed nodes) falls back to the old full pass.
- The comparison of an element's old and new computed style no longer spreads both maps (`sameStyle`).

### 2. The ad blocker's element hiding was dropped after scripts
**File:** `src/browser/engine/page-renderer.ts` (`rulesFromDomStyles`)
**Problem:** on any page with scripts, ad slots hidden by the 1.93/1.97 user stylesheet came back after the scripts ran. The 1.93 test used a page with no scripts.
**Root cause:** the post-script rebuild kept only external-sheet rules and the DOM's `<style>` text, so the user stylesheet's rules (source `style-tag`, not external) were lost.
**Fix:** the user stylesheet is kept (last in the cascade). The new test fails on the old code.

### 3. The first style pass ordered a page's `<style>` rules before its linked sheets
**File:** `src/browser/engine/page-renderer.ts`
**Problem:** a later-listed linked sheet could override a page's own `<style>` until a script ran.
**Root cause:** `extractStylesFromDocument` lists `<style>` rules first. The second pass had been quietly correcting the order (external sheets, then `<style>`), so removing it exposed the bug (the existing "keeps cascade order … survives scripts" test failed).
**Fix:** the first pass uses the same order: external sheets, `<style>` rules, then the user stylesheet.

### 4. A site without HTTPS typed by name could not be opened (2.06)
**Files:** `android/.../UrlInputResolver.kt`, `BrowserViewModel.kt`
**Problem:** typing `httpforever.com` showed "Page Load Failed: A secure connection to this site couldn't be made" with `https://httpforever.com/`.
**Root cause:**
- The resolver turned the bare name into `https://httpforever.com`, and the engine received an explicit https address.
- The engine's fallback to http applies only when it upgraded an `http://` address itself. HTTP-only sites, which the engine opened before the resolver existed in its current form, never got the chance.

**Fix:**
- `UrlInputResolver.engineAddress(typed, resolved)`: a host typed **without** a scheme goes to the engine as `http://…`. The engine upgrades it to https and falls back to http if that fails (HTTPS-first, as in mainstream browsers).
- Unchanged: an explicit `https://`, searches, localhost and IP addresses, built-in pages.
- A unit test covers these cases.

## Not changed (recorded)
- **CNN's page content:** after rendering, the screen shows the headline and grey loading placeholders (the site fills the rest in with scripts that don't complete in Nova's engine). Same on 2.04 and 2.05.
- **`scripts` phase:** 14.7–17.6 s on the tablet vs 0.5 s offline. It is dominated by downloading CNN's scripts and the slower CPU. Not measured separately.
- **Missing spaces in bold headings (httpforever.com):** still open (see 2.04).

## Files Modified
| File | Change |
|------|--------|
| `src/browser/engine/page-renderer.ts` | incremental post-script restyle; stylesheet reuse; user stylesheet kept; first-pass rule order; cheap style comparison (#1–#3) |
| `src/browser/rendering/dom-tree.ts` | `removalCount` (#1) |
| `android/.../UrlInputResolver.kt` | `engineAddress` (#4) |
| `android/.../BrowserViewModel.kt` | navigate() passes the engine address (#4) |
| `android/.../UrlInputResolverTest.kt` | HTTPS-first test (#4) |
| `android/app/build.gradle` | 2.04 (105) → 2.06 (107) |

## Files Created
| File | Purpose |
|------|--------|
| `tests/post-script-style-204.test.ts` | user stylesheet survives scripts (fails on the old code); sibling/nth-child restyle; removal fallback; a script-added style (#1–#3) |

## Test Results
```
npx vitest run tests/post-script-style-204.test.ts → 4 passed; with the fix stashed: 1 failed (user stylesheet after scripts)
npx tsc --noEmit -p .              → clean
npx eslint (changed files)         → 0 errors
npx vitest run                     → Test Files 339 passed (339); Tests 11469 passed (11469)
gradlew :app:testDebugUnitTest :app:assembleRelease → exit 0; UrlInputResolverTest 19 tests, 0 failures
apksigner verify Nova-2.05.apk / Nova-2.06.apk → verified (2.06 = versionCode 107)
Offline CNN with scripts (probe, 2 runs each): 42.6 s → 27.3 s / 27.9 s
OnePlus Pad Go (OPD2305, Android 14), screen on and unlocked:
  2.04 CNN: render line after ~44 s; style 12.9 s, scripts 18.4 s, style2 12.1 s, layout 3.0 + 1.6 s
  2.05 CNN: restored-tab load style2 11.9 s (full pass: most of the page dirty);
            intent-opened load style2 16 ms, scripts 14.7 s, style 11.5 s
  2.05 httpforever.com typed → "Page Load Failed" (https only, no fallback) → #4
  2.06 httpforever.com typed → https fetch failed, log "falling back to http://httpforever.com", page rendered
       (doc/img/2026-11-10-nova-2.06-httpforever-typed.png); the heading "Why does this site exist?" shows its spaces
  2.06 example.com typed → fetched https://example.com/ directly, rendered, no fallback
```
