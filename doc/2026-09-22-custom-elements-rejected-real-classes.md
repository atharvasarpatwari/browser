# `customElements.define()` Rejected Every Real Class-Based Custom Element

**Date:** 2026-09-22
**Session:** Asked to keep filling gaps. Bisected several more sites (MDN, npmjs.com — both clean) before `cloudflare.com`'s own homepage surfaced a real, high-impact Web API gap: a genuine `TypeError` from Nova's own `customElements.define()` implementation, not a missing dependency or third-party script.
**Status:** Completed (1 root cause fixed)

---

## Summary

`customElements.define()`'s validity check only accepted a constructor whose internal representation had `type: 'function'` — but a real custom element is almost always defined via `class X extends HTMLElement { ... }` (a class is required here in practice, since the element needs a real `super()` call), and a class's internal representation has `type: 'class'`, a distinct value. Every real class-based custom element definition — the overwhelmingly common case in real-world code (found via Astro's own hydration runtime, shipped on Cloudflare's homepage) — was rejected with `TypeError: Custom element constructor must be a function`.

## Root Cause

**File:** `src/browser/js/web-apis.ts` (`createCustomElementsObject()`, the `define` method)
**Real trigger:** `class f extends HTMLElement { constructor() { super(...arguments); ... } ... } customElements.define("astro-island", f)` — Astro's real, unminified-in-purpose hydration-island custom element, shipped as part of Cloudflare's own homepage bundle.
**Problem:** The check was `(ctor as JSObject).type !== 'function'` — but `class X {}` declarations build a `JSObject` with `type: 'class'` (confirmed in `interpreter.ts`'s `buildClassObject()`), and a plain `function X(){}` declaration/expression instead produces a `JSFunction` with `type: 'closure'` — *neither* of which is `'function'`. The check as written only ever accepted a narrower, less common internal shape, silently excluding both of the two ways real code actually defines a constructor.
**Fix:** Broadened the check to accept `'function'`, `'class'`, or `'closure'` — matching the exact same three-way check already used elsewhere in this codebase for "is this thing callable" (`values.ts`'s new `objectPrototypeToStringTag()` from earlier the same day, and `console-api.ts`'s existing function-detection logic).

## Notes

- Verified this doesn't just fix the reported crash but genuinely registers and retrieves the element correctly: `customElements.define('my-el', MyClass)` followed by `customElements.get('my-el') === MyClass` now round-trips for a real `class extends HTMLElement` shape, a plain function constructor (the pre-existing, still-working case), and the exact real Astro `customElements.get(name) || customElements.define(name, ...)` idempotent-registration idiom.
- Confirmed non-function values (`customElements.define('bad-el', {})`) are still correctly rejected with the same `TypeError` — the fix widens what counts as a valid constructor, it doesn't remove the validation.
- Re-ran cloudflare.com's real page after the fix: all 18 real inline scripts now execute with zero errors (previously 1 failure).

## Files Modified

| File | Change |
|------|--------|
| `src/browser/js/web-apis.ts` | `customElements.define()`'s constructor-validity check now accepts `type: 'function'`, `'class'`, or `'closure'` instead of only `'function'` |
| `tests/e2e/js-dom-api-sweep.spec.ts` | 1 new real-Electron regression check (`customElements.define()` with a real `class extends HTMLElement`) |

## Test Results

```
npx tsc --noEmit -p .                                    → 0 errors
npx vitest run (full suite)                              → 227/228 files, 9313/9316 tests passed (3 pre-existing DNS-timeout failures, unrelated — see doc/known-test-failures.md)
npx playwright test (full real-Electron e2e suite)       → 7/7 passed
Real cloudflare.com (before → after)                     → 18/18 inline scripts execute with 0 errors (previously 1 failure)
```

## Verification Steps

1. Bisected `cloudflare.com`'s real homepage after MDN and npmjs.com both came back clean; found the exact failing script and root-caused it directly from the error message and the real script's source (no red herrings this time).
2. Confirmed the exact internal representation mismatch (`type: 'class'` for classes vs. the check's `'function'`-only acceptance) against `interpreter.ts`'s own class-building code.
3. Verified the fix with 4 cases: a real class extending `HTMLElement`, a plain function constructor (pre-existing behavior, confirmed unbroken), the exact real Astro idempotent-registration shape, and confirmation that genuinely invalid values are still rejected.
4. Re-ran the real `cloudflare.com` page's full script set to confirm 0 remaining failures.
5. Added 1 permanent e2e regression check, rebuilt, and re-ran the full real-Electron e2e suite, the full vitest suite, and a full typecheck for regressions.
