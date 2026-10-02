# Forms Were 0/14 on the Feature Audit — Now Interactive End-to-End

**Date:** 2026-09-28
**Session:** Continued from the prior TLS+input-events session's own audit-driven roadmap. Planned and implemented "Phase 2 — Form Interactivity": text input editing, checkbox/radio toggling, link-click navigation, and GET form submission, all previously nonexistent.
**Status:** Completed (4 root causes fixed)

---

## Summary

The 360-item feature audit's Forms section was 0/14: `<input>`/`<textarea>`/`<select>` rendered as blank, unsized boxes; nothing toggled a checkbox; clicking a real `<a href>` did nothing; no form ever submitted. This session built the whole chain — sizing, real IDL `value`/`checked`/`selectedIndex` properties, default actions for pointer/keyboard events, and GET-only form submission with validation — verified with a real, no-mock `PageRenderer` test pipeline and confirmed live in the running dev-preview app (typed text, a toggled checkbox, and a full form submission all visibly worked, with the resulting address bar reading `http://localhost:8845/search?q=cats&opt=on`).

POST/method/body form submission was scoped out up front as its own follow-up (Phase 2d) — the plumbing chain (`ResourceLoadOptions` → `NavigationEntry` → `IPageLoader` → `browser-engine.ts`'s loader call) is longer than this phase's GET-via-`navigate()` shortcut, and nothing in this phase depends on it.

## Root Causes

1. **Form controls had no intrinsic size and no real `value`/`checked`/`selectedIndex` IDL properties.** `layout-engine.ts`'s `resolveIntrinsicSize()` never treated `input`/`textarea`/`select` as replaced elements, so they laid out as zero-size boxes; `dom-bindings.ts`'s `wrapElement()` had no `value`/`checked`/`selectedIndex` getters/setters at all. Fixed by giving form controls real UA-default sizes (16×16 checkbox/radio, 150×50 textarea, 150×24 everything else) and adding real IDL properties on new optional `DomElement` fields (`value`/`checked`/`selectedIndex`/`caretOffset`) — seeded from the `value=`/`checked=` content attribute (or a `<textarea>`'s text content, which is where its real initial value lives, not a nonexistent `value=""` attribute) only until first touched, then diverging from it exactly like real `defaultValue`/`defaultChecked` semantics. `paint-engine.ts` gained matching paint blocks to actually draw a checkbox glyph and a control's current text.
2. **No "default action" concept existed for any dispatched event.** `dispatchPointerEvent`/`dispatchKeyEvent` only ran a page's own `addEventListener` handlers — clicking a checkbox never toggled it, clicking a real `<a href>` never navigated anywhere, and clicking anything never gave it keyboard focus. Fixed by adding a shared default-action pass (gated on `!defaultPrevented`, matching real browser event semantics) to both dispatch methods: click sets focus, toggles checkbox/radio (unchecking same-named radios document-wide — noted with a `ponytail:` comment as a known ceiling, since no `<form>`-scoping concept exists yet), or walks up to the nearest `a[href]`/submit control; keydown edits `.value` at the caret (`editValueAtCaret`, new) or submits/inserts-newline on Enter depending on `<input>` vs `<textarea>`. This also required removing a stale `if (!this.pageEventLoop) return false` guard from both dispatch methods — it was silently skipping all default-action logic on any page with zero `<script>` tags, since default actions (unlike the JS listener dispatch they sit next to) need no JS environment at all.
3. **Mutating raw `DomElement` fields during a default action bypassed the reflow controller's dirty-tracking, making edits invisible until an unrelated repaint coincidentally fired.** Found by live-testing in the actual dev-preview app, not by the automated suite (which never asserts on painted pixels): typing into a focused text input correctly mutated `.value` (confirmed by unit tests) but showed nothing on screen. `toggleCheckable`/`runKeyDefaultAction` only appeared to work at all because a focus change happens to call `markDirty` as a side effect — which fires once, not on every subsequent keystroke. Fixed by adding the same explicit `reflowController.invalidatePaint(el)` + `.requestFrame()` calls already used elsewhere for async lazy-image-load repaints, directly after every checkbox/radio toggle and every successful `editValueAtCaret`.
4. **GET form submission (`submitForm`, new) had a real serialization bug: a checked checkbox with no `value=""` attribute serialized as `opt=` (empty) instead of the real HTML default `opt=on`.** Also found live, not by the unit tests — the existing test happened to always give its checkbox an explicit `value="1"`, masking the gap. The correct `?? 'on'` fallback already existed in `js/index.ts`'s unrelated `collectFormEntries` (used for `FormData`) but `submitForm`'s independent field-walking logic and `dom-bindings.ts`'s JS-visible `.value` getter both lacked it. Fixed both call sites and added a real-pipeline test asserting the resulting query string reads `opt=on`.

## Notes

- `<select>` renders as a closed box showing the selected option's text; `.value`/`.selectedIndex` are fully scriptable, but there is no dropdown UI and no keyboard option-cycling this phase — a real dropdown overlay is a separate, larger UI subsystem, deferred entirely.
- Radio-group unchecking is document-wide by `name`, not form-scoped (no `<form>`-association concept exists anywhere in the engine yet) — marked with a `ponytail:` comment naming the ceiling; two unrelated same-named radio groups on one page would false-positive against each other.
- Validation covers `required` only (blocks submission, focuses the first invalid field) — `pattern`/`min`/`max`/`minlength`/`maxlength` are real gaps, not built speculatively ahead of a concrete need.
- Precise coordinate-based dispatch tests needed real layout-box values, not guesses — the default 8px UA body margin plus inline layout meant naive coordinates missed targets; confirmed via temporary layout dumps, then hardcoded with explanatory comments (dumps deleted afterward).
- Live browser verification needed exact `clientX`/`clientY` computed from `canvas.getBoundingClientRect()` and the canvas's real-vs-CSS pixel scale factors — the `computer` tool's screenshot-scaled click coordinates aren't precise enough for ~9px-wide targets like a checkbox.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/rendering/dom-tree.ts` | Added optional `value`/`checked`/`selectedIndex`/`caretOffset` fields to `DomElement` |
| `src/browser/js/dom-bindings.ts` | Added `value`/`checked`/`selectedIndex` getter/setter pairs in `wrapElement()`; fixed `<textarea>` initial value to read text content, not a nonexistent attribute; fixed checkbox/radio `.value` to default to `"on"` per real HTML semantics |
| `src/browser/rendering/layout-engine.ts` | `resolveIntrinsicSize()` now treats `input`/`textarea`/`select` as replaced elements with UA-default fallback sizes |
| `src/browser/rendering/paint-engine.ts` | New paint blocks: checkbox/radio glyph, and a control's current text value (including `<select>`'s selected-option text) |
| `src/browser/engine/page-renderer.ts` | New default-action passes in `dispatchPointerEvent`/`dispatchKeyEvent` (focus, checkbox/radio toggle, link navigation, text editing, Enter-to-submit); new `submitForm()` with `required`-field validation and GET query-string building; removed a stale `pageEventLoop`-gating guard that silently disabled all of this on script-free pages; explicit repaint calls after every DOM mutation |
| `tests/dom-focus-and-input-events.test.ts` | +4 tests: `.value`/`.checked` divergence from their content attributes, `<textarea>` initial value from text content, `<select>` value/selectedIndex resolution |

## Files Created

| File | Purpose |
|------|---------|
| `tests/page-renderer-form-defaults.test.ts` | Real-pipeline (no mocks) coverage: checkbox/radio toggle, link-click navigation, text typing/Backspace, Enter-submits vs. Enter-inserts-newline, submit-button query-string building (including the `"on"` default), required-field validation, closed-`<select>` value resolution |
| `doc/2026-09-28-form-interactivity-implemented.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 233/233 files, 9378/9378 tests (15 new: 11 form-defaults, 4 value/checked)
```

## Verification Steps

1. Real-pipeline tests (no mocks): rendered real HTML through the actual `PageRenderer`, dispatched real pointer/key events, and asserted on the resulting DOM state (`.checked`, `.value`) and navigation calls — not just "didn't throw".
2. Live-verified in the dev preview end to end: typed "cats" into a real text input and confirmed it appeared on screen; toggled a checkbox and confirmed the glyph filled in; clicked "Go" and confirmed the address bar read `http://localhost:8845/search?q=cats&opt=on`, correctly reflecting both the typed value and the checkbox's real default value.
3. Ran the full suite (`npx tsc --noEmit -p .`, `npx vitest run`) after every fix, including the two bugs (repaint reliability, checkbox `"on"` default) found only through live testing — zero regressions across all 233 files / 9378 tests.
