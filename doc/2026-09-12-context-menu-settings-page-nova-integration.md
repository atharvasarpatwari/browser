# Context Menu & Settings Page — Nova-* CSS Integration

**Date:** 2026-09-12
**Session:** Continuation of the nova-* CSS class integration (`1c3667e`, `e9e6bab`): surveyed the rest of `src/ui/` for the same inline-styles-vs-unused-classes gap and fixed the two clean matches, `context-menu.ts` and `settings-page.ts`.
**Status:** Completed

---

## Summary
After wiring the browser chrome to `.nova-*`, this session surveyed the remaining `src/ui/pages/` and `src/ui/components/` files for the same pattern (ad-hoc inline styles duplicating an already-defined, unused `.nova-*` class). Two were clean 1:1 matches:

- **`context-menu.ts`** — already set `className = 'nova-context-menu'` on the menu root but then fully overrode every visual property with an inline `style.cssText`, making the CSS class dead. Rows and separators used no classes at all. Rewired to `.nova-context-menu-item`/`-icon`/`-separator`/`-item--disabled`, dropping the manual mouseenter/mouseleave hover handlers now that `.nova-context-menu-item:hover` does it.
- **`settings-page.ts`** — a two-column settings shell (`settings-page`/`settings-sidebar`/`settings-nav-item`/`settings-content`) that maps almost exactly onto `styles.css`'s `.nova-settings`/`.nova-settings-nav`/`.nova-settings-nav-item`/`.nova-settings-content`/`.nova-settings-section`/`.nova-settings-row`/`.nova-settings-label`/`.nova-input`/`.nova-select` component set. Rewired all of it, and replaced the boolean setting's hand-rolled div-based toggle (manual position/background/left-offset math on every render) with a real `<label class="nova-toggle"><input type="checkbox">...` using the `.nova-toggle`/`.nova-toggle-track` CSS (native `:checked` state — less code and more accessible than the div it replaced).

Three other pages were surveyed and left alone this session: `downloads-page.ts` and `research-page.ts` use the same ad-hoc-inline-style pattern and are reasonable next candidates (styles.css has matching `.nova-downloads`/etc. sections), but weren't converted to keep this session's diff reviewable. `new-tab-page.ts` was deliberately **not** touched — reading it in full showed it's a complete, differently-themed page (animated particle background, gradient title, a "Nova Browser" logo/search/quick-links-to-internal-pages/frequent-sites layout) rather than the mockup's greeting+clock+speed-dial-to-visited-sites design the `.nova-nt-*` classes were built for; forcing it into that mold would be a feature redesign, not a wire-up, so it was left as a flagged follow-up rather than risking its working particle/dropdown/context-menu interactions for a cosmetic-only goal.

## Root Causes
None — refactor/wiring session, not a bug fix.

## Files Modified
| File | Change |
|------|--------|
| `src/ui/components/context-menu/context-menu.ts` | Renders with `.nova-context-menu`/`.nova-context-menu-item(-icon/-separator/--disabled)`; deleted the overriding inline `cssText` and manual hover handlers. |
| `src/ui/pages/settings-page.ts` | Renders with `.nova-settings`/`.nova-settings-nav(-item)`/`.nova-settings-content`/`.nova-settings-section(-title)`/`.nova-settings-row`/`.nova-settings-label`/`.nova-settings-control`/`.nova-input`/`.nova-select`/`.nova-toggle(-track)`/`.nova-btn.nova-btn-primary`; boolean control switched from a manually-styled div to a real checkbox + `.nova-toggle` label. |
| `tests/settings-page.test.ts` | Two assertions updated: `.settings-page`→`.nova-settings`, `.settings-sidebar`/`.settings-content`→`.nova-settings-nav`/`.nova-settings-content`. |

## Files Created
| File | Purpose |
|------|---------|
| `doc/2026-09-12-context-menu-settings-page-nova-integration.md` | This change log |

## Test Results
```
tsc --noEmit              -> 0 errors
vitest run (targeted)     -> settings-page.test.ts + settings-service.test.ts: 36/36 passing
vitest run (full suite)   -> 9178/9179 passing (the 1 failure is the pre-existing
                              MobileLayout bug from the earlier nova-* session,
                              unrelated to these files)
Live Electron verification -> SettingsPage mounted directly in the running renderer
                              (dev-server ES-module import, since the nav pipeline
                              needs a real network engine this dev harness doesn't
                              have wired): .nova-settings/.nova-settings-nav/
                              .nova-settings-nav-item.active/.nova-settings-content
                              all present, 3 rows on the General section, toggle/
                              select/input all present, clicking a different nav
                              item switches the rendered section correctly
                              ("General" -> "Privacy & Security").
```

## Verification Steps
1. `npx tsc --noEmit` — clean.
2. Grepped `src/`/`tests/` for the old class-name strings (`settings-page`, `settings-sidebar`, `settings-nav-item`, `settings-content`) to find and update the one dependent test file.
3. `npx vitest run tests/settings-page.test.ts tests/settings-service.test.ts` — 36/36.
4. `npx vitest run` (full suite) — 9178/9179, same lone pre-existing failure as the prior nova-* session.
5. Launched the real Electron app and, from within the running renderer, dynamically imported `settings-page.ts` and mounted a `SettingsPage` instance into an overlay div (the normal `nova://settings` route needs a live navigation-engine controller this dev harness doesn't construct) — screenshotted it and confirmed the cyan active-nav accent, real toggle switch, and styled select/input all render as designed; confirmed section-switching works by clicking a different nav item.
