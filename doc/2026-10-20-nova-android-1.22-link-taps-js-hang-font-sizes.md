# Nova Android 1.21–1.22 — Tapping Links Works, the jQuery Freeze, Font-Size Units

**Date:** 2026-10-20
**Session:** "keep improving the nova app…" → form controls Round A approved ("Round A: paint + type + GET submit"). The tap plumbing Round A needs came first. Testing it on the user's OPD2305 tablet showed that **tapping a link never worked**, and that following one to iana.org **froze Nova**. This change log covers those fixes. Form fields themselves (paint, typing overlay, submit) are the next part of Round A.
**Status:** Completed. Verified on the tablet (1.21 for taps; 1.22 for the freeze and font sizes).

---

## Summary
- **Link taps (1.21):** Nova's page is one painted bitmap, and only the long-press menu ever hit-tested it, so a tap on a link did nothing. Taps now hit-test the layout, fire `click` through the page's own scripts (`preventDefault()` honoured), and follow the link (`target=_blank` opens a new tab).
- **Freeze:** following "Learn more" to iana.org **froze the WebView thread for good**, and even the back button died. The cause was that **Nova's JS parser looped forever on the `in` operator** (jQuery: `t-1 in e`). Fixing that exposed more parser and interpreter bugs that break jQuery and most sites; all fixed.
- **Font sizes:** iana.org then drew its text at about 100 px. `font-size: 100%` was read as `parseFloat` = 100 px, `rem` used the parent's size, and relative sizes compounded when inherited. Fixed.
- **Result on the tablet:** iana.org renders readably in 1.22, and back returns to example.com instantly.

## Root Causes
### 1. Taps on the page did nothing
**Files:** `src/app/android-native-bridge.ts`, `src/ui/pages/browser-window.ts`, `src/browser/engine/{browser-engine,page-renderer}.ts`, `src/browser/js/dom-bindings.ts`
**Problem:** no code handled a plain click on the page canvas. The Android bridge's click listener only swallowed the click after a long-press.
**Fix:**
- **Hit-testing:** `BrowserWindowPage.clientToPage(x, y)` maps a viewport point to page coordinates (canvas offset, `object-fit` scaling, scroll) with the same `computeViewTransform`/`pointToFrame` the desktop context menu uses.
- **Activation:** `activateAt()` hit-tests, dispatches `click` via `BrowserEngine.dispatchPageEvent` → `PageRenderer.dispatchPageEvent` → `dispatchDomEvent` (new export; capture/target/bubble through the existing element `dispatchEvent`), then follows the nearest `a[href]`. `#…` and `javascript:` links are ignored; `ponytail:` they aren't run.
- **Android long-press:** it passed client points to `resolveContextTarget`, which expects page coordinates, so after scrolling it hit the wrong element. It now converts first.

### 2. Page listeners could never be called from outside a script run
**Files:** `src/browser/js/event-loop.ts`, `src/browser/engine/page-renderer.ts`
**Problem:** `Interpreter.run()` clears the global JS caller in its `finally` block. Any listener invoked later (a tap's `click`) threw "No JS interpreter registered", and the error was swallowed.
**Fix:**
- `EventLoop.runWithInterpreter(fn)` restores the page's interpreter around host-initiated calls and drains microtasks.
- `PageRenderer` keeps the page's event loop and resets it on every new page.

### 3. A long-press with no click swallowed the next tap
**File:** `src/app/android-native-bridge.ts`
**Problem:** the long-press set a "swallow the next click" flag that only a click cleared.
**Fix:** each new `pointerdown` clears it.

### 4. JS parser: `x in obj` looped forever (the iana.org freeze)
**File:** `src/browser/js/parser.ts`
**Problem:** `TokenType.In` had a precedence (11) but no `parseInfix` case. The Pratt loop called `parseInfix`, got `left` back unchanged, and saw `in` again, forever. This was on the WebView's main thread, so all of Nova froze: no back button, `fps=0.3`.
**Fix:**
- added `case TokenType.In` to the binary operators;
- the Pratt loop now stops when `parseInfix` consumes nothing, so any other operator missing a case becomes a parse error, not a frozen browser.

### 5. Object literals: `get:`/`set:` properties, method shorthand, accessors
**Files:** `parser.ts`, `interpreter.ts`
- `{ get: function(){} }` was taken as a getter. `get`/`set` are now accessor keywords only when a property name follows.
- `{ foo() {} }`: `parseParams` was called without consuming `(`…`)`, so **every object method shorthand failed to parse**.
- `get x() {}` / `set x(v) {}` were stored as plain values. They're now accessor descriptors (`getter`/`setter`).

### 6. `for (var a = 1, b = 2; …)`: only one declarator was read
**File:** `parser.ts`
**Fix:** comma-separated declarators are read in the `for` head.

### 7. Lexer: regex-vs-division state only maintained in `tokenize()`
**File:** `src/browser/js/lexer.ts`
**Problem:** the parser streams tokens via `nextToken()`, but `lastTokenType` (which decides whether `/` starts a regex) was only updated in `tokenize()`. So mid-file `x = /re/` lexed as division: jQuery failed with "Expected RBracket, got Illegal".
**Fix:**
- `nextToken()` skips comments and records the token type itself;
- `readTemplatePart` does the same.

### 8. Regex literals were strings
**Files:** `parser.ts`, `interpreter.ts`
**Problem:**
- `evalLiteral` returned the source text, so `typeof /a/` was `"string"`, `/re/.test(…)` was `undefined`, and `"s".match(/re/)` returned `null`.
- The parser split the pattern on `/`, which broke on escaped slashes.
- The string methods `split`/`replace`/`match`/`search` stringified regex arguments; `replace` had no function-callback support, and one method table lacked `search`.

**Fix:**
- regex literals are built through the page's own `RegExp` constructor;
- the pattern and flags are cut at the last `/`;
- `patternArg`/`regexArg`/`stringReplace` use the native RegExp behind a regex object and support `replace(re, fn)`.

### 9. Font sizes: `%` became px, `rem` used the parent, relative sizes compounded
**Files:** `src/browser/rendering/layout-engine.ts`, `src/browser/rendering/css5/computed-value-resolver.ts`
- **Layout:**
  - `resolveFontSize` had no `%` case, so `"100%"` → `parseFloat` = **100 px** (iana.org's giant text);
  - `raw.endsWith('em')` was tested before `rem` and matches it too;
  - `rootFontSize` was always 16 px, ignoring `<html>`'s font size (`html { font-size: 62.5% }`).

  Fixed: a `%` case, `rem` before `em`, and `documentRootFontSize()` from `<html>`'s computed style.
- **Cascade:**
  - computed `font-size` kept `em`/`%` as written, so an inheriting child applied them again: a span inside `font-size: 2em` drew at 64 px instead of 32 px;
  - per CSS Fonts 4 §2.5 the computed value is absolute, so `resolveFontSizeKeyword` now resolves `%`/`em` against the parent;
  - five older tests had asserted the relative pass-through and were updated with a note.

## Files Modified
| File | Change |
|------|--------|
| `src/app/android-native-bridge.ts` | taps → `activateAt`; long-press uses page coordinates; a new press clears click suppression |
| `src/ui/pages/browser-window.ts` | `clientToPage`, `activateAt` |
| `src/browser/engine/browser-engine.ts` | `dispatchPageEvent` (interface + engine + optional on the renderer) |
| `src/browser/engine/page-renderer.ts` | `dispatchPageEvent`, `pageEventLoop` (reset per page) |
| `src/browser/js/dom-bindings.ts` | `dispatchDomEvent` export |
| `src/browser/js/event-loop.ts` | `runWithInterpreter` |
| `src/browser/js/parser.ts` | `in` operator; no-progress guard; get/set names; method parentheses; multi-declarator `for`; regex pattern split |
| `src/browser/js/lexer.ts` | `nextToken` skips comments and tracks `lastTokenType`; template parts too |
| `src/browser/js/interpreter.ts` | regex literals as RegExp; accessor properties; regex-aware string methods + `replace(re, fn)`; `search` in both tables |
| `src/browser/rendering/layout-engine.ts` | font-size `%`, `rem` order, root font size from `<html>` |
| `src/browser/rendering/css5/computed-value-resolver.ts` | computed font-size `%`/`em` → px |
| `tests/android-native-bridge.test.ts` | fake page gains `clientToPage`/`activateAt`; tap → `activateAt` test |
| `tests/example-domain-render.test.ts` | 3 tests: font-size `%`, rem/em, no compounding |
| `tests/css5-computed-styles-pipeline.test.ts`, `tests/css5-computed-value-resolver.test.ts`, `tests/css5-container-nesting.test.ts` | spec-correct computed font-size expectations |
| `android/app/build.gradle` | 1.20 (21) → 1.21 (22) → 1.22 (23) |
| `android/app/src/main/assets/*` | rebuilt bundle |

## Files Created
| File | Purpose |
|------|--------|
| `tests/page-tap-activation.test.ts` | 5 tests: page click listeners and `preventDefault`, link navigation resolved against the page, `target=_blank`, cancelled/`javascript:`/`#` links, scroll mapping |
| `tests/js-parser-in-operator.test.ts` | 8 tests: `in`, jQuery's `isArrayLike`, for-in still works, get/set names, multi-declarator `for`, streaming regex vs division, regex literals + string methods, **all of jQuery 3 parses in bounded time** |
| `tests/fixtures/iana-2026/` | iana.org/help/example-domains with its CSS and three scripts (the page that froze Nova) |
| `doc/2026-10-20-nova-android-1.22-link-taps-js-hang-font-sizes.md` | This change log |

## Test Results
Each fix's test was confirmed to fail first. Reverting the bridge made the tap test fail. The parser tests hung or failed until each fix landed. The compounding test failed with the resolver change reverted.
```
npx tsc --noEmit -> exit 0
npx vitest run   -> 275 files, 10528 passed (10528)
gradlew :app:testDebugUnitTest :app:assembleRelease :app:assembleDebug -> BUILD SUCCESSFUL; 36 Kotlin tests, 0 failures
apksigner verify Nova-1.22.apk -> verified (1,523,448 B)
iana.org render (fixtures, PageRenderer at 1070 px): never returned (killed at 200 s) -> 757 ms
```

## Verification on the tablet (OPD2305, Android 14)
| Check | 1.20 | After |
|-------|------|-------|
| Tap "Learn more" on example.com | nothing happened | **1.21: navigates** to iana.org/help/example-domains |
| iana.org | WebView thread frozen (`fps≈0.3`), back dead, ~100 px text | **1.22: renders in normal sizes** (heading, paragraphs, list, dark header/footer); scripts finish |
| Back button | — | **1.22: instantly back to example.com**, scroll position restored |

## Known ceilings
- On iana.org, one script still errors (`[ScriptEngine] … [object Object]`, a thrown error object whose message isn't surfaced), and the page continues past it.
- The IANA logo SVG draws stretched and garbled, and the nav sits a little high.
- Form fields are still invisible and can't be typed into: the next part of Round A.

## What's new in Nova 1.21–1.22 (user-facing)
- Tapping a link opens it.
- Sites using jQuery (a large share of the web) no longer freeze the app.
- Text sizes on real sites are right, with no more giant headlines everywhere.
