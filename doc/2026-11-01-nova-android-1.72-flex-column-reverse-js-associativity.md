# Nova Android 1.72: Flex Column/Reverse/Auto Margins, JS Operator Associativity, Block Scopes, Logical Assignment, Computed Colours — Tested on the Tablet

**Date:** 2026-11-01
**Session:** "keep improving the nova app"; then "the android system is connected test it now"
**Status:** Completed (installed on the tablet; 14/14 device checks pass on the build before the JS-probe fixes; the final build is installed but not re-run on the device because the tablet was in use)

---

## Summary

- **Remaining real-page renders:** the Google, example.com and httpbin renders were inspected. httpbin is right. Google's saved page is a JS-only bot check, so a blank page is expected. Example.com's missing accented, Arabic and Chinese letters only happen in the headless 8×8 fallback font; the device draws text with real fonts (1.16).
- **Flexbox/grid probe:** 39 cases; 32 passed. Flex columns, the reverse directions and `margin: auto` were broken; all now pass.
- **On the tablet:** 1.72 (which includes 1.71) is installed, and a new device page `tests/fixtures/device-pages/v172.html` checks 1.65–1.72. The first run passed 11/14. The failures exposed a JS parser bug (arithmetic grouped the wrong way) and `getComputedStyle` colour serialisation. After fixing both: **14/14**. httpforever also renders correctly on the device.
- **JS probe:** 89 expressions were run through Nova and compared with V8 (Node); 86 matched at first. Blocks shared the enclosing scope, and `||=` / `&&=` didn't parse. After fixing both: **88/89**. The remaining one: Nova accepts `-2 ** 2`, which V8 rejects as a SyntaxError; it is deliberately left lenient.
- **Version:** Nova **1.72** (versionCode 73). No separate 1.71 APK was built; 1.72 contains its fixes.

## Root Causes

### 1. Flex columns used the page width as their main size
**File:** `src/browser/rendering/layout-engine.ts` (`layoutFlexContainer`)
**Problem:**
- The flex context always got `availableMainSize: availableWidth`. In a column, that made every flex item (`flex: 1`, auto basis) size against the page width.
- Each item's box height was then overwritten with its cross size (the width), so every column item was as tall as the page was wide.
- The container returned that cross size as its height.
- Auto-height items had a basis of 0, so text items overlapped.

**Fix:**
- **Main size:** a column's main size is its definite content-box height, or else the sum of its items' bases.
- **Auto basis:** an auto basis is measured by laying the item out at the column's width (`measureLayout` + `layoutNode`).
- **Box height:** the box keeps the height layout gave it.
- **Container height:** the container returns its main extent.
- **Non-stretched items:** items that don't stretch (`align-items: center`, `margin: 0 auto`) are sized shrink-to-fit with `measureContentWidth`.
- **Size override:** the temporary main-size override on the item's style is now restored after layout. It used to stay, so a re-layout at another width kept the old size as if it were authored.

### 2. row-reverse / column-reverse packed at the start
**File:** `src/browser/rendering/formatting/flex-context.ts`
**Problem:** the items were reversed, but offsets were still measured from the left/top. So `row-reverse` drew 2,1 at the left instead of at the right edge.
**Fix:** items keep their order, and main offsets are computed from main-start and mirrored (`availableMainSize - offset - size`). Main-start margins and auto margins are the right/bottom ones in reverse directions.

### 3. Cross-axis auto margins ignored
**File:** `flex-context.ts` (`computePositions`)
**Problem:** `margin: auto` only worked on the main axis, so an item meant to be centred both ways sat at the top.
**Fix:** cross-axis auto margins take the line's free cross space ahead of `align-self` (Flexbox §8.1).

### 4. JS binary operators grouped right (found on the tablet)
**File:** `src/browser/js/parser.ts` (`parseInfix`)
**Problem:** the right operand was parsed at the operator's own precedence, so same-precedence operators nested to the right:
- `10 - 3 - 2` = 9
- `10 / 4 / 2` = 5
- `a + b - c - d` = `a + b - (c - d)`

Every page script doing chained arithmetic computed wrong numbers. The device check `(i.x-c.x)-(c.x+c.w-i.x-i.w)` gave 64 instead of 0.
**Fix:** the right operand is parsed at `prec + 1` (left-associative), except for `**`. Logical operators do the same.
```ts
const right = this.parseExpression(tok.type === TokenType.StarStar ? prec : prec + 1);
```

### 5. getComputedStyle returned colours as authored
**File:** `src/browser/js/index.ts`
**Problem:** `getComputedStyle(el).color` returned `rgb(0,128,0)`, `green` or `#008000` exactly as written. Browsers return `rgb(0, 128, 0)`, so scripts comparing colours never matched.
**Fix:** `*color` properties that `isParsableColor` accepts are serialised as `rgb(r, g, b)` / `rgba(r, g, b, a)`.

### 6. Blocks shared their enclosing scope
**File:** `src/browser/js/interpreter.ts`
**Problem:** a `BlockStatement` ran in the enclosing environment, so `let`/`const` inside `{ … }`, `if`, `try` or `else` blocks overwrote outer bindings of the same name. For example, `let a = 1; { let a = 2; }` left `a` as 2.
**Fix:** `blockScope()` gives a block its own `Environment` when it declares `let`/`const`/`class`. Blocks without them keep the enclosing scope, so sloppy-mode function declarations in blocks stay visible outside (Annex B).

### 7. `||=` and `&&=` were not tokens
**Files:** `src/browser/js/tokens.ts`, `lexer.ts`, `parser.ts`, `interpreter.ts`
**Problem:** only `??=` existed. `x ||= 5` lexed as `||` followed by `=`, a syntax error that dropped the whole script.
**Fix:**
- Added `PipePipeAssign` and `AmpersandAmpersandAssign` tokens.
- The lexer emits them, and they count as regex-allowed contexts.
- They have assignment precedence in the parser.
- The interpreter evaluates them for identifiers and members. The bytecode compiler already supported them.

## Open finding (not fixed)
On the device, a shrink-to-fit box can be a few pixels narrower than its text as painted: the "centred" label's last letter overhangs its green box. Node's measurer agrees with itself, so this is a device measure-vs-paint mismatch in the real-font path. It needs on-device instrumentation to find.

## Incident during the session
`git worktree remove --force` on a temporary baseline worktree followed its `node_modules` junction and emptied `E:\nova_1\node_modules`, which the worktree also links to. It was restored with `npm ci` from the lockfile (601 packages; vite 8.1.5, matching the lockfile). The bundle's tracked chunks are unchanged. **Lesson:** never junction `node_modules` into a throwaway worktree; copy, or remove the junction first with `rmdir`.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/layout-engine.ts` | column main size, measured column basis, shrink-to-fit non-stretched column items, restored main-size override, column box height and container extent (#1) |
| `src/browser/rendering/formatting/flex-context.ts` | reverse directions mirror offsets; reverse-aware margins and auto margins; cross-axis auto margins (#2, #3) |
| `src/browser/js/parser.ts` | left-associative binary/logical operators (#4); logical-assignment precedence and parsing (#7) |
| `src/browser/js/index.ts` | computed colour serialisation (#5) |
| `src/browser/js/interpreter.ts` | block scopes; logical-assignment evaluation (#6, #7) |
| `src/browser/js/tokens.ts`, `src/browser/js/lexer.ts` | logical-assignment tokens (#7) |
| `android/app/build.gradle` | 1.70 (71) → 1.72 (73) |
| `android/app/src/main/assets/**` | rebuilt web bundle |

## Files Created

| File | Purpose |
|------|--------|
| `tests/flex-grid-172.test.ts` | 39 flexbox/grid layout cases |
| `tests/js-arith-computed-color-172.test.ts` | operator associativity (7), block scope and logical assignment (4), computed colours (4) |
| `tests/fixtures/device-pages/v172.html` | on-device self-checking page for 1.65–1.72 (PASS/FAIL list) |

## Verification

- **Node renders:** compared the current build with a HEAD (1.71) baseline. IANA and httpforever are pixel-identical. Wikipedia's mobile header now shows its right-side search and account icons, which 1.71 dropped.
- **Tablet (OPD2305), Nova 1.72:**
  - `v172.html`: 11/14 before the JS fixes, **14/14** after.
  - httpforever (`device-pages/hf`) renders correctly.

## Test Results

```
npx tsc --noEmit                                        → clean
npx vitest run tests/flex-grid-172.test.ts              → 39 passed
npx vitest run tests/js-arith-computed-color-172.test.ts → 15 passed
JS probe (89 expressions vs V8)                         → 86 → 88 (remaining: -2 ** 2 accepted)
npx vitest run                                          → Test Files 320 passed (320); Tests 11125 passed (11125)
gradlew :app:testDebugUnitTest :app:assembleRelease     → OK
apksigner verify Nova-1.72.apk                          → verified; versionCode 73, versionName 1.72
adb install -r Nova-1.72.apk                            → Success
```
