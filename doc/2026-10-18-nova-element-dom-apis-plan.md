# Nova — Element DOM APIs for Page Scripts — Plan

**Date:** 2026-10-18
**Session:** "keep improving the nova app…", round 5. This plan follows up the "Not fixed" section of `2026-10-18-nova-android-1.14-device-found-black-page-script-rawtext.md`.
**Status:** Completed. Approved ("Implement the full plan") and shipped in Nova 1.15; see `2026-10-18-nova-android-1.15-element-dom-apis-find-focus.md`.

---

## Why
Page scripts run in Nova's own interpreter (`src/browser/js/`) against element wrappers made by `wrapElement` in `js/dom-bindings.ts`. On the phone, 1.14 renders example.com, but its 1.9 KB `s.js` stops at `Cannot read properties of undefined (reading 'lang')`. Tracing it showed these gaps, all in `wrapElement`:

| Gap | What happens now |
|-----|------------------|
| `el.querySelector` / `el.querySelectorAll` | `undefined`; only `document.*` has them |
| `el.insertAdjacentHTML` | missing, so the call silently does nothing |
| `append`, `prepend`, `before`, `after`, `remove`, `replaceChildren`, `closest` | missing |
| `innerHTML` | read-only snapshot; assigning it does nothing to the DOM |
| `children`, `childNodes`, `parentNode`, `firstChild`, `innerHTML` | **values captured when the wrapper is first made**. The wrapper is cached per element, so after any `appendChild`/`removeChild` a script keeps seeing the old tree |
| `lang`, `dir`, `title`, `hidden` | no reflected properties; `el.lang = 'en'` sets nothing |
| `[...undefined]` in the interpreter | gives `[undefined]` instead of throwing a TypeError |

## Plan (one file in the main, plus one DomTree method)
1. **`DomTree.parseFragment(htmlNodes, parent)`** (public) wraps the existing private `convertNode`. It's the only way to turn parsed HTML into DOM nodes without rebuilding the whole document.
2. **Live getters:** `children`, `childNodes`, `parentNode`, `firstChild`, `lastChild`, `nextElementSibling`, `previousElementSibling` and `innerHTML` become getters, as `textContent` already is.
3. **`innerHTML` setter** and **`insertAdjacentHTML(position, html)`**: parse with `HtmlParser` as `<body>…</body>`, convert with (1), then insert through `domTree.insertBefore`/`appendChild`, so mutations and reflow work as they do now. Script text in the fragment isn't run (same as browsers).
4. **`querySelector(All)` / `closest` / `matches`:** filter `domTree.querySelectorAll(sel)` to the element's descendants (`ponytail:` a global query plus a filter, O(document) per call). `closest` walks up and uses the existing `matches`.
5. **`append` / `prepend` / `before` / `after` / `remove` / `replaceChildren`:** take nodes or strings (strings become text nodes) and go through the existing DomTree mutation methods.
6. **Reflected attributes:** `lang`, `dir`, `title` and `hidden` as getter/setter pairs over the attributes.
7. **Interpreter:** spreading `undefined`/`null` throws `TypeError: … is not iterable`.

## Tests
- A new `tests/dom-bindings-element-apis.test.ts`, run through `runJS` on a parsed page:
  - each API above;
  - live `children` after `appendChild`;
  - `innerHTML` round trip;
  - `insertAdjacentHTML` with all 4 positions.
- End to end: example.com's real `s.js` runs **without errors** and adds its 5 translations, the "Learn more" link and the SVG. It is re-added to `tests/example-domain-render.test.ts`, external-script path.

## Risk
- **Security:** `insertAdjacentHTML`/`innerHTML` must not bypass the sanitizer. `on*` attributes and `javascript:` URLs in fragments get the same checks `setAttribute` uses (`isEventHandlerAttribute`, `isBlockedUrlScheme`).
- **Existing tests:** some may rely on the stale snapshots; any that do will be listed in the change log.

## Deliverable
Nova **1.15**, plus a change log, README, and analytics entries (worktree and `E:\nova_1`). The find-bar focus fix (found on the phone this round: the find field didn't take focus when opened from the menu) ships in the same build.
