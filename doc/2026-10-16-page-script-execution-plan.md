# Page Script Execution — Plan

**Date:** 2026-10-16
**Session:** "Decide and fix: page scripts are stripped before running", found while wiring cookies (`2026-10-16-engine-cookie-wiring.md`).
**Status:** Completed. Approved (enable scripts, paint first, no toggle) and implemented; see `2026-10-17-page-script-execution.md`. Implementation also fixed three script-runner bugs found on the way: a per-script global environment, the inline CSP check applied to external scripts, and ignored nonces.

---

## What happens today (traced this session)

| Step | Code | Effect |
|------|------|--------|
| Renderer construction | `src/app/main.ts:~895` `new PageRenderer({ ..., sanitizer: new HtmlSanitizer(), ... })` | default config |
| Render step 3b | `page-renderer.ts` `render()` → `sanitizer.sanitize(doc, domTree)` | removes every `<script>` (`DEFAULT_STRIPPED_ELEMENTS`) because `keepScriptElements` isn't set; also `on*` attributes |
| Render step 5 | `executeAllScripts(doc, ...)` | finds **no scripts**, so it does nothing in the shipping app (desktop and Android) |
| Tests | `tests/page-renderer.test.ts`, `security-runtime-enforcement.test.ts` construct `PageRenderer` **without** a sanitizer | so tests exercise script execution that production never reaches |

**History:** the sanitizer was added in `75f1066` (2026-07-19) per `doc/xss-mitigations-plan.md`, which says it should be "called in page-renderer.ts after HtmlParser.parse() completes, **before script execution**", with `<script>` in its strip list. That treats the page's *own* scripts as injected markup, so the separately built step 5 can never run. No doc says page JavaScript is meant to be off.

**Already in place if scripts run:**
- **CSP:** the inline check (`scriptEnforcer.checkInlineScript`), external scripts through `security.checkSubresource`, and SRI.
- **A 5 s time limit per script:** `Interpreter.DEFAULT_MAX_EXECUTION_MS`, enforced by `checkTimeout`.
- **CORS for page requests:** `fetch` and `XMLHttpRequest` are bound with CORS enforcement (`createFetchFn(..., corsEngine)`, `createXMLHttpRequestClass(...)`).
- **Isolation:** page JS runs in Nova's own interpreter, not the host JS engine. It can only reach what the bindings expose (document, window, location/history, fetch, XHR, storage, timers…), never the Electron renderer or the Android WebView's real `window`.
- **Unchanged by this fix:** the second sanitizer that runs during tree building (`mutation-observer.ts` `sanitizeAddedNode`) strips only `on*` attributes and dangerous URLs, not `<script>`.

**Risks of turning scripts on:**
- Scripts run **before** layout and paint. A slow page script delays the first paint by up to 5 s per script, and the interpreter is slower than V8, especially on phones.
- Real-world scripts will hit gaps in the engine's bindings and throw. `runJS` returns `result.error` and the page continues, so the cost is mostly wasted time.
- Pages may change their own content when scripts run, so reference rendering (e.g. the HN page) can differ.

## Plan

1. **Keep page scripts:** construct the production sanitizer with `keepScriptElements: true`. It still strips `object/embed/applet/base/template`, `on*` attributes (inline handlers aren't wired to events in the engine anyway), and `javascript:`/`data:` URLs. Script-inserted content is still sanitized by the tree-building sanitizer.
2. **A time limit per page, not just per script:** stop running further scripts on a page once ~3 s of total script time is spent (`ponytail:` constant), log what was skipped, and render.
3. **Paint first, then run scripts** *(optional; see question)*: lay out and paint the script-free document, run scripts, then re-apply styles, re-lay out and paint again. Users see content immediately and scripts upgrade it.
4. **A JavaScript on/off setting** *(optional; see question)*: a single boolean read by the renderer. Android needs a toggle in the overflow menu; desktop needs a settings switch.
5. **Tests:**
   - a test that builds the renderer **exactly like `main.ts`** (with the sanitizer) and asserts an inline script runs, so production and tests can't diverge again;
   - per-page time limit;
   - CSP still blocks a disallowed inline script;
   - `on*` still stripped;
   - `object` still stripped.
   Plus the full vitest suite, `tsc`, the e2e fidelity suite (`tests/e2e/fidelity-audit.spec.ts`), and a headless Android-bundle boot where a page script sets `document.cookie` and navigates (the probe that showed the bug).
6. Rebuild the engine bundle and ship Nova **1.8**; doc plus README/analytics.

## Not in scope
- Wiring inline `on*` handler attributes to events.
- Filling binding gaps that real sites hit; that's measured and noted, not fixed here.
