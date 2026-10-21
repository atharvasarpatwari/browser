# Nova — Web Page Form Controls (inputs, buttons, checkboxes, select, submit) — Plan

**Date:** 2026-10-19
**Session:** "keep improving the nova app…", round 10.
**Status:** Round A completed in 1.23 (see 2026-10-20-nova-android-1.23-form-controls-real-page-fixes.md); Round B planned

---

## Problem (probed this round)
A page with `<form action="/s"><input name="q" placeholder="Search" value="hi"> <button>Go</button><textarea>t</textarea><select><option>A</option></select><input type="checkbox" checked></form>` rendered at 412 px through `PageRenderer` gives:

| Element | What Nova produced |
|---------|--------------------|
| `<input>` | a 396×24 box with **no border, no background, no text**: neither the value "hi" nor the placeholder is painted, so the field is invisible |
| `<button>` | only the text "Go" (no button shape) |
| `<textarea>`, `<select>` | 5 px wide; only their text |
| checkbox | 396×24 of nothing |

There's no code anywhere that edits a field. The page is one painted bitmap, so tapping a search box does nothing, and **no site's search, login or comment box can be used**. Taps are already hit-tested against layout boxes (`layout.getElementAtPoint`, used for links and long-press), so that part exists.

## Plan
1. **Paint form controls (engine):**
   - UA styles: `display: inline-block`, a 1px #767676 border, 1–2px padding, a white background and a radius for `input`/`textarea`/`select`/`button`.
   - HTML default sizes: a text input is about 20 characters wide; a textarea is 2 rows × 20 columns; checkbox and radio are 13×13.
   - Painted content: the value (or the placeholder in grey), clipped to the box; the checkbox tick and radio dot; the select's chosen option plus a ▾; the button label centred.
   - `type=hidden` isn't rendered.
2. **Typing into fields (Android):** a tap on a text-like `input` or a `textarea` places a real HTML `<input>`/`<textarea>` over the field's box in Nova's WebView UI. It uses the same font size and padding, is scaled to the page and follows scrolling. The Android keyboard, cursor, selection, autocorrect and paste then work natively.
   - Each keystroke writes back to the DOM element's value, repaints the field, and fires `input` events for page scripts. Blur fires `change`.
   - Enter submits the field's form; the "Go" or search key on the keyboard does too.
   - `type=password` uses a password overlay and paints dots.
3. **Checkbox, radio and select:**
   - A tap toggles a checkbox, or picks a radio within its `name` group, and fires `input`/`change`.
   - A select opens a native-feeling option list as an overlay sheet.
4. **Form submission:**
   - **What's sent:** the successful controls are collected per the HTML spec (named, enabled, checked boxes, the chosen options, the clicked submit button).
   - **GET:** navigates to `action?query`.
   - **POST:** `application/x-www-form-urlencoded`, if the engine's navigation can carry a body. If not, GET first and POST in a follow-up round; this gets checked before starting.
   - **Validation:** `required` stops submission.
   - **Scripts:** a `submit` event goes to page scripts, and `preventDefault()` is honoured (many sites handle search in JS).
5. **Script API:**
   - live `value`, `checked`, `selectedIndex`, `disabled`, `placeholder` and `type` properties on element wrappers;
   - `form.submit()`, `form.reset()` and `form.elements`;
   - `input.focus()` opens the overlay.

## Security
- Typed values stay in the page's DOM; nothing new is persisted.
- Password overlays turn off autocorrect and suggestions (`autocomplete="off"` semantics on the overlay) and are painted as dots.
- POST submission goes through the same navigation, CSP and mixed-content checks as other navigations.

## Tests
- **Engine unit tests:**
  - control boxes and borders;
  - painted value, placeholder and password dots;
  - checkbox tick;
  - default sizes;
  - collecting the form data set (GET query and POST body) per the spec, including `required`;
  - `submit`-event cancel;
  - script `value`/`checked`.
- **Built-in browser:** render a form fixture and look at it; drive the overlay with typed input; check the DOM value and repaint.
- **Devices** (Realme phone and/or OPD2305 tablet): type into a real site's search box (DuckDuckGo html, Wikipedia) and submit.

## Phasing
This is about two rounds of work:
- **Round A:** items 1, 2 and 4 (GET) and the `value` part of 5. You can then search and log in on most sites.
- **Round B:** items 3, POST if not done in A, and the rest of 5.
