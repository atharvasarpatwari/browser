# DevTools Accessibility Tab (Phase 6j)

**Date:** 2026-10-01
**Session:** Explicitly flagged by the prior session as "a strong, low-risk future candidate" after finding DevTools' Console/Network/Elements panels already shipped via `devtools-panel.ts` — overturning an older "DevTools is an unwired shell" assumption. This round went from that sizing-level finding to full implementation detail, and caught a real bug in the obvious approach before writing any code.
**Status:** Completed (1 root cause fixed, in the sense of a real, independently-tested audit engine finally getting a UI consumer)

---

## Summary

`AccessibilityPanel` (`src/browser/devtools/accessibility-panel.ts`) is a real, independently-tested audit engine with zero UI consumer. Added it as a 4th "Accessibility" tab to the already-shipped `DevToolsPanel` (Console/Network/Elements), following that file's exact existing per-tab pattern — no new abstractions, since the file has no tab-definition array to begin with.

The naive approach — pass the DOM tree's document root straight to `AccessibilityPanel.runAudit()` — would have shipped a feature that always silently reports zero issues. Caught before writing code: `runAudit()`'s internal `checkNode()` immediately returns if `!isA11yElement(node)`, which requires `nodeType === 'element'`; but `domTreeProvider().getDocument()` returns a `DomDocument` whose `nodeType` is `'document'`. The existing Elements tab sidesteps this same trap by iterating `doc.children` itself rather than rendering `doc` directly — the fix here is the identical pattern: call `runAudit()` once per top-level child of `doc.children`, not once on `doc`.

Two smaller pre-existing wrinkles also needed fixing for a 4th pull-based tab to behave correctly: the header's "Refresh" button was hardcoded to always re-render Elements, and `clear()`'s fallback branch assumed "not console, not network" meant "must be elements" — both would have silently done the wrong thing while the Accessibility tab was active.

## Root Causes

1. **A real, tested accessibility audit engine had no UI anywhere to reach it.** Fixed by adding a 4th tab to `DevToolsPanel`, reusing the exact `tabButton`/pane/`selectTab`/`updateTabStyles` pattern the other three tabs already use. The one new piece of real logic is `renderAccessibilityTab()`, which audits each top-level child of the live document (not the document itself, per the bug above) and renders the resulting `A11yAuditIssue[]` list with a color-coded severity badge, matching `renderElementsTree()`'s "re-read the live DOM fresh every time the tab is selected" convention — `AccessibilityPanel` is constructed fresh per render, not cached, since it has a zero-arg constructor and `runAudit()` already resets its own state every call.

## Notes

- Fixed two adjacent, pre-existing bugs that a naive 4th-tab bolt-on would have inherited rather than fixed: the "Refresh" button (previously hardcoded to `renderElementsTree()`) now dispatches on `this.activeTab`, and `clear()`'s previously-unconditional `else { renderElementsTree() }` fallback now explicitly checks for `'elements'` before falling through to `renderAccessibilityTab()`. Console/Network are unaffected — they're push-updated via `addEntry`/`addNetworkEntry` and have no "refresh" concept.
- Live dev-preview verification couldn't exercise the real keyboard-shortcut UI path (Ctrl/Cmd+Shift+J): this harness's viewport consistently renders Nova's mobile chrome regardless of `window.innerWidth` (confirmed 1280px, well above the 768px mobile breakpoint, yet the mobile bottom-nav chrome persisted through a hard reload) — a pre-existing environment characteristic of this preview harness across the whole session, not something this phase introduces or could fix, and `MobileLayout` has no DevTools support at all to toggle. Worked around with a stronger form of live verification instead: dynamically imported the real `HtmlParser`, `DomTree`, and `DevToolsPanel` classes, parsed a real HTML fixture, built a real DOM tree, attached a real `DevToolsPanel` to a live container, and clicked the real Accessibility tab button — exercising the exact same production code path (`domTreeProvider` → `runAudit` → render) end to end with zero synthetic test doubles, arguably a stronger proof than clicking through chrome would have been.
- Explicitly out of scope: click-to-highlight on an issue row (jumping to/highlighting the element on the live page) — no such mechanism exists for Elements or Network rows either today to extend, so building one would be new scope, not a port of an existing pattern.

## Files Modified

| File | Change |
|------|--------|
| `src/ui/components/devtools-panel/devtools-panel.ts` | New `'accessibility'` tab: button, pane, `renderAccessibilityTab()`, wired into `build()`/`selectTab()`/`updateTabStyles()`/`clear()`/`dispose()`; fixed the Refresh button and `clear()`'s fallback to dispatch by active tab instead of always assuming Elements |

## Files Created

| File | Purpose |
|------|---------|
| `tests/devtools-panel-accessibility.test.ts` | Real-pipeline (real `DevToolsPanel`, real `AccessibilityPanel`, no mocks) coverage: missing-alt issue renders, clean tree shows the empty state, no provider shows "(no page loaded)", Refresh and Clear both re-run the audit rather than falling through to Elements |
| `doc/2026-10-01-devtools-accessibility-tab-implemented.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 241/241 files (minus 3 pre-existing, unrelated DNS-resolver failures), 9416/9416 tests (5 new)
```

The 3 failing `tests/networking-integration.test.ts` DNS-resolver cases are pre-existing and untouched by this change — the same environment condition noted in the last several changelogs.

## Verification Steps

1. Unit tests: a fake document whose only child is an `<img>` with no `alt`/`aria-label` renders a real "missing-alt" error row; a clean `<div>`-only tree renders the empty state; no `domTreeProvider` set renders "(no page loaded)"; Refresh re-runs the audit against updated fake data while Accessibility is active; Clear re-runs the audit rather than rendering Elements.
2. Real-pipeline live verification (described in Notes): real `HtmlParser` + `DomTree` + `DevToolsPanel`, no mocks, against a real HTML fixture — confirmed the Accessibility tab correctly surfaced a real `[ERROR] <img> — Image without alt text` finding (plus ARIA-role warnings on `<html>`/`<head>`/`<body>`, the existing audit engine's own pre-existing behavior, unrelated to this phase) and that Clear correctly re-ran the audit in place.
3. Ran the full suite — 0 regressions in any file this phase touched; the only failures are the 3 pre-existing, environment-dependent DNS tests noted above.
