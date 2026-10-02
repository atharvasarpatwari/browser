# POST Form Submission (Phase 2d) — Forms Were Silently Downgraded to GET

**Date:** 2026-09-28
**Session:** Closed out "Phase 2d," deferred from the earlier Forms (Phase 2) session pending investigation of the plumbing chain. Three parallel investigations (POST forms, settings-page UI, video/audio) compared candidate next phases; POST forms won as the smallest, most surgical, and most overdue.
**Status:** Completed (1 root cause fixed)

---

## Summary

Forms (Phase 2) shipped GET-only and deferred POST as a "long chain through 5 files" the original audit hadn't actually traced. Investigation this session found the real, current bug: **a `<form method="post">`'s `method` attribute was never read anywhere in the codebase** — such a form was silently treated as GET, not "defaulting to GET." The plumbing chain turned out real but shallow once traced end to end (6 files, not the vaguely-estimated 5 — the investigation's file list omitted `page-renderer.ts` itself, which is where the actual missing behavior — reading `method`/building a POST body — had to be added). Scope was capped to `application/x-www-form-urlencoded` (the HTML default and by far the common case); `multipart/form-data` has a complete, already-built encoder (`MultipartBuilder`) sitting unused, but wiring it hits a real `HttpRequestSpec.body: string` vs. `Uint8Array` type mismatch that's an independent follow-up, not built speculatively here.

Live-verified end to end in the dev preview: submitting a real `<form method="post">` navigated to `http://localhost:8847/search` with **no query string**, and the response showed `POST body received: q=cats&opt=1` — proving the fields were sent in the request body, not appended to the URL.

## Root Causes

1. **No layer in the navigation/loading pipeline had anywhere to put an HTTP method or body, and `PageRenderer.submitForm()` never read a form's `method` attribute at all.** Every form submission — regardless of `method="post"` in the markup — went through the exact same GET-only code path added in Phase 2. Fixed by threading an optional `{ method?, body? }` through the whole chain as one additive, backward-compatible unit: `NavigationRequest`/`NavigationEntry` (`navigation-controller.ts`) gained the two fields; `INavigationController.navigate()` gained a 4th optional `init` parameter (existing single-arg callers and test fakes are unaffected — JS ignores extra call arguments); `IPageLoader.load()` gained an optional 3rd parameter; `ResourceLoadOptions` (`resource-loader.ts`) gained `method`/`body`, replacing the 3 previously-hardcoded `method: 'GET'` literals (in the CORS pre-request check, the real `HttpRequestSpec` sent to the HTTP client, and the CORS post-response check); and `submitForm()` now reads `form.attributes.get('method')`, keeping the GET branch completely untouched and adding a POST branch that reuses the exact same `URLSearchParams` object the GET path already builds, sending it as the request body instead of a query string.

## Notes

- **Multipart/form-data is a real, separate follow-up, not attempted here.** `src/browser/networking/multipart.ts`'s `MultipartBuilder` is a complete, already-tested encoder with zero wiring — but its output is `Uint8Array`, and `HttpRequestSpec.body` is typed `string` (consumed as a plain string by `FetchHttpClient`). Widening that type ripples through every `IHttpClient` implementer; a real task, not a one-line addition, so left for its own phase.
- **Redirect-following does not demote POST to GET on 301/302/303** (real browsers do; 307/308 correctly preserve method+body in any browser). `resource-loader.ts`'s redirect loop resends the same `method`/`body` unchanged on every hop regardless of status code — marked with a `ponytail:` comment naming the gap. Getting the demotion subtly wrong seemed worse than an honest, flagged gap, and form POSTs redirecting via 301/302 are rare in practice.
- **`<button formaction>`/`formmethod` overrides are not implemented** — a submit control always uses its owning form's own `action`/`method`, matching the scope Phase 2 already established for `action`.
- Investigation found the original Phase 2 plan's file-line citations for this work had drifted (two features landed on `navigation-controller.ts`/`browser-engine.ts` since it was written) and that the actual entry point for the missing behavior — reading `method`/building a POST body — was in `page-renderer.ts`, a file the original 5-file estimate never listed at all.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/navigation/navigation-controller.ts` | Added optional `method`/`body` to `NavigationRequest`/`NavigationEntry`; `navigate()` gained a 4th optional `init` parameter |
| `src/browser/engine/engine-types.ts` | `IPageLoader.load()` gained an optional 3rd `init` parameter |
| `src/browser/engine/page-loader.ts` | Threads the new `init` param into its one `resourceLoader.loadResource()` call |
| `src/browser/engine/browser-engine.ts` | Passes `session.entry.method`/`.body` into the `loader.load()` call |
| `src/browser/networking/resource-loader.ts` | Added `method`/`body` to `ResourceLoadOptions`; replaced 3 hardcoded `method: 'GET'` literals with the real value; threaded `body` into the request spec |
| `src/browser/engine/page-renderer.ts` | `submitForm()` reads the form's `method` attribute; POST reuses the existing `URLSearchParams` as the request body instead of a query string |
| `tests/page-renderer-form-defaults.test.ts` | +1 real-pipeline test for `method="post"`; extended `makeFakeController()` to also record the `navigate()` `init` argument |
| `tests/resource-loader.test.ts` | +2 tests: GET-default-with-no-body when options are omitted, and method/body pass-through to the HTTP client |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 235/235 files, 9366/9366 tests (3 new)
```

## Verification Steps

1. Real-pipeline tests (no mocks): the 11 pre-existing GET-path tests in `tests/page-renderer-form-defaults.test.ts` pass completely unmodified (none of them set a `method` attribute, so they never leave the untouched GET branch); a new test asserts a `method="post"` form's submission reaches the fake controller as `{ method: 'POST', body: 'q=cats&opt=1' }` via the new 4th `navigate()` argument.
2. `resource-loader.test.ts`: confirmed `loadResource()` defaults to GET with no body when options are omitted, and correctly threads a given `{ method: 'POST', body }` through to the HTTP client.
3. Live-verified in the dev preview end to end: submitted a real `<form method="post" action="/search">` against a local test server; the resulting address bar read `http://localhost:8847/search` (no query string) and the page showed `POST body received: q=cats&opt=1` — proof the fields traveled in the request body, not the URL.
4. Ran the full suite (`npx tsc --noEmit -p .`, `npx vitest run`) after every change — 0 regressions across all 235 files / 9366 tests.
