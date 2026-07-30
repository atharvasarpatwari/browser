# Screen Reader Support

**Date:** 2026-07-29
**Session:** Screen reader (accessibility) module — role mapping, accessible name/description/value computation, state computation, accessibility tree, IScreenReaderManager with event lifecycle
**Status:** Completed

---

## Summary

Created a self-contained screen reader support module (`src/browser/accessibility/screen-reader.ts`) with:
- **Role mapping** — HTML tag → implicit ARIA role (42 tags), explicit `role=` attribute parsing, resolved role
- **Accessible name computation** — `aria-label` > `aria-labelledby` > `title` > `alt` priority
- **Accessible description** — `aria-description` > `aria-describedby`
- **Value computation** — `aria-valuetext` > `value` > `aria-valuenow`
- **State computation** — 13 states from ARIA/HTML attributes (disabled, hidden, expanded, collapsed, selected, pressed, checked, unchecked, busy, invalid, required, readonly, multiline, visited)
- **Accessibility tree** — `buildAccessibilityTree()` builds `AccessibleNode` tree from `A11yDomNode` DOM root
- **ScreenReaderManager** — event-based lifecycle, enable/disable, announce API (polite/assertive), focus tracking, tree building, node lookup, dispose

## Files Created

| File | Purpose |
|------|---------|
| `src/browser/accessibility/screen-reader.ts` | Core module — all types, role mapping, name/description/value/state computation, tree builder, manager |
| `src/browser/accessibility/index.ts` | Module index — re-exports all public types and functions |
| `tests/screen-reader.test.ts` | 86 comprehensive tests — all pass |

## Architecture Decisions

- AriaDomNode/AriaDomElement interfaces mirror `DomNode`/`DomElement` shape but are framework-agnostic (no dependency on dom-tree.ts or html5/dom.ts)
- `buildAccessibilityTree` handles text node roots (produces `role: 'none'`, `tagName: '#text'` node)
- `explicitRole()` validates against a fixed set of 42 known ARIA roles; invalid roles return null
- Manager uses `Set<A11yEventHandler>` for subscriptions, returns `() => void` unsubscribe (matching `IDisposable`-adjacent pattern used in settings modules)
- `announce()` with `'assertive'` priority interrupts; `'polite'` queues after current speech
- Focus tracking announces the focused element's accessible name via the announce system

## Test Results

```
✓ tests/screen-reader.test.ts (86 tests)
```

## Verification Steps

1. `npx vitest run tests/screen-reader.test.ts` — 86/86 pass
2. `npx vitest run tests/screen-reader.test.ts tests/settings-features.test.ts tests/bookmarks-history.test.ts tests/html5-events.test.ts tests/css5-computed-styles-pipeline.test.ts` — 418/418 pass across 5 files
