# TLS Validation Was Rubber-Stamping Untrusted Certs, and Only Click Ever Reached Page Content

**Date:** 2026-09-27
**Session:** Audited the whole browser against a 360-item feature checklist (243/360 fully implemented). Picked the two highest-priority gaps from that audit — one a real security bug, one the single biggest interactivity gap — and planned + implemented both.
**Status:** Completed (2 root causes fixed)

---

## Summary

The audit's two standout findings: (1) Nova accepted self-signed and untrusted-CA HTTPS certificates for any site, because the live evaluator rubber-stamped any presented certificate as valid; (2) only `click` ever reached a rendered page's content — keyboard input, mouse wheel, resize, and double-click never did, and there was no way for an element to hold keyboard focus at all. Both are now fixed and verified against real infrastructure (a real self-signed TLS server; a real `PageRenderer` rendering real HTML+`<script>`), not mocks.

The original plan's specific mechanism for the TLS fix (compare the certificate chain against a parsed trust-store PEM set) turned out to be infeasible once investigated — Node's root CA store is raw PEM blocks, `CertificateInfo` only carries parsed name strings, and the existing `verifyChain` unit tests prove it was never meant to do real root-of-trust checking (they pass an *empty* trust store and still expect `Valid`). The real, simpler fix: Node's TLS socket already computes a real `authorized`/`authorizationError` verdict against the system trust store on every handshake, regardless of `rejectUnauthorized` — that signal just wasn't being read anywhere.

## Root Causes

1. **`TlsHandler.defaultEvaluator` returned `Valid` for any chain with at least one certificate — no trust check at all.** `socket-owner.ts`'s `rejectUnauthorized: false` is deliberate (lets the peer cert be inspected before deciding, confirmed in `doc/2026-07-26-certificate-validation-implementation.md`) and was correctly left alone. The real gap: nothing read the real `TLSSocket.authorized`/`.authorizationError` properties Node computes internally regardless of `rejectUnauthorized`. Fixed by adding `getTlsAuthorization()` to the socket IPC layer (`socket-owner.ts` → `socket-proxy.ts` → `ISocketHandle`), threading it through `tls-handler.ts`'s `buildCertificateChainReal()`, and folding it into the verdict via a new `applyRealAuthorization()` — which only overrides an otherwise-`Valid` status, and only when a real handshake actually ran, so the pre-existing synthetic/fallback chain path (used by tests and when `useRealTls` is off) is untouched. Also wired `TlsCertificateError` into the existing navigation-failure error page with a real cert-specific message (`TlsHandler.describeCertError()`) instead of a generic one.
2. **Only `click` reached page content; keyboard, wheel, dblclick, and resize never did, and there was no focused-element concept anywhere.** `dispatchPointerEvent` was the only bridge from real host input to the page's live DOM event system, and `:focus`/`document.activeElement` didn't exist at all (`:focus` was hardcoded `false` in the selector engine). Fixed by adding: focused-element state (`DomTree.getFocusedElementId/setFocusedElementId`), `element.focus()/blur()`, `document.activeElement`, a real `:focus` CSS pseudo-class, typed `MouseEvent`/`KeyboardEvent`/`WheelEvent` object constructors (the existing `createEventObject` only produced bare `Event`-shaped objects with no `clientX`/`key`/`deltaY`), and three new `PageRenderer` dispatch methods threaded through `BrowserEngine` → `browser-window.ts` → new canvas listeners in `content-renderer.ts`. Also discovered and fixed that the `<canvas>` itself had no `tabIndex` and so could never receive real keyboard focus at all, regardless of any of the above.

## Notes

- **Scope boundary, not a bug**: this does not make wheel/scroll visually pan the page. Investigation found `paint-engine.ts` has no scroll-offset concept at all — not even for existing per-element `overflow:auto` containers that `layout-engine.ts` already computes but paint never reads. That's a real, separate gap needing a change to the rasterizer itself, not something to rush inside this session. What's real today: `keydown`/`keyup`/`wheel`/`dblclick`/`resize` all correctly reach page JS `addEventListener` handlers with correct event data (verified with real listeners in real page scripts) — they just don't yet move any pixels.
- Considered deleting `certificate-validator.ts` as genuinely dead code (it's DI-registered but never resolved). Investigation found it's actually reachable through `CertificateService`/`SecurityLayer`, a 3-file chain with its own existing test coverage — unwinding that is disproportionate cleanup for this fix and isn't the security-relevant part anyway, so it was left alone.
- Found the real layout-box coordinates needed for hit-test-based dispatch tests the hard way: the default 8px `body` margin from the UA stylesheet means `(0,0)`/`(5,7)` land in the margin and hit nothing — `(10,10)` is inside real content. Not a bug, just what real layout does.

## Files Modified

| File | Change |
|------|--------|
| `src/browser/networking/socket-handle.ts` | Added `getTlsAuthorization()` to `ISocketHandle` |
| `src/browser/networking/socket-owner.ts` | Implemented `getTlsAuthorization()`, reading the real `TLSSocket.authorized`/`.authorizationError` |
| `src/browser/networking/socket-proxy.ts` | Implemented the renderer-side `getTlsAuthorization()` proxy call |
| `src/browser/networking/tls-handler.ts` | Added `applyRealAuthorization()` and `describeCertError()`; `buildCertificateChainReal()` now also returns the real authorization verdict; `negotiate()` folds it in |
| `src/ui/pages/browser-window.ts` | TLS-specific error messages on navigation failure; wired the 3 new dispatch methods to new content-renderer canvas listeners |
| `src/browser/engine/browser-engine.ts` | Added `dispatchKeyEvent`/`dispatchWheelEvent`/`dispatchResizeEvent` to `IPageRenderer`/`IBrowserEngine` and their implementations |
| `src/browser/engine/page-renderer.ts` | Implemented the 3 new dispatch methods; refactored the shared interpreter/microtask/reflow bookkeeping into one `runDispatch()` helper; `dispatchPointerEvent` upgraded to a real `MouseEvent`-shaped object |
| `src/browser/js/dom-bindings.ts` | Added `createMouseEventObject`/`createKeyboardEventObject`/`createWheelEventObject`; added `element.focus()/blur()` and `document.activeElement` |
| `src/browser/js/index.ts` | Re-exported the 3 new event-object constructors |
| `src/browser/rendering/css5/selector.ts` | `SelectableElement` gained an optional `focused` field; `:focus` now reads it instead of hardcoded `false` |
| `src/browser/rendering/dom-tree.ts` | Added focused-element state to `DomTree`; `SelectableDomNode` exposes `focused` |
| `src/ui/components/content-renderer/content-renderer.ts` | New `dblclick`/`keydown`/`keyup`/`wheel` canvas listeners and a `ResizeObserver`; canvas now has `tabIndex=0` and focuses itself on click |
| `tests/socket-proxy.test.ts` | +2 tests, incl. a real end-to-end `TlsHandler.negotiate()` check against a real self-signed local TLS server |
| `tests/tls-handler.test.ts` | +5 tests for `applyRealAuthorization`/`describeCertError` |
| `tests/page-renderer.test.ts`, `tests/security-runtime-enforcement.test.ts` | Added the 2 new `IDomTree` mock methods needed after the interface grew |

## Files Created

| File | Purpose |
|------|---------|
| `tests/dom-focus-and-input-events.test.ts` | Real `focus()`/`blur()`/`document.activeElement`/`:focus` coverage, plus the 3 new typed event-object constructors |
| `tests/page-renderer-input-dispatch.test.ts` | Real end-to-end coverage (real HTML+`<script>`, no mocks) for all 3 new dispatch methods plus the upgraded `dispatchPointerEvent` |
| `doc/2026-09-27-tls-validation-rubber-stamp-and-page-input-events-never-dispatched.md` | This change log |

## Test Results

```
npx tsc --noEmit -p .   → 0 errors
npx vitest run          → 232/232 files, 9363/9363 tests (20 new: 7 TLS, 13 input-events)
```

## Verification Steps

1. TLS: stood up a real local HTTPS server with a self-signed cert (existing `createSelfSignedCert` test helper), connected through the real `SocketOwner`/`SocketProxy` IPC wire, and confirmed `getTlsAuthorization()` reports `authorized:false` — then confirmed `TlsHandler.negotiate()` against the same server now returns `verified:false`, where before this fix it would have returned `Valid`.
2. Input events: rendered real HTML pages with real inline `<script>` tags (through the actual `PageRenderer` pipeline, no mocked DOM) that register `addEventListener` for `keydown`/`wheel`/`dblclick`/`resize`, then called each new dispatch method and asserted the script's own DOM mutation happened — not just that the call returned without throwing.
3. Live-checked in the dev preview: confirmed the `<canvas>` correctly becomes `document.activeElement` after a real click, and that dispatching real `keydown`/`wheel` events produces no console errors against a loaded page.
4. Ran the full suite before and after each phase to confirm zero regressions throughout.
