# XSS/Injection Mitigations — Implementation Plan

**Date:** 2026-07-19
**Session:** XSS/injection mitigations for Nova Browser
**Status:** Planned

---

## Summary

Wire the existing 8 CSP modules into the pipeline, add an HTML/DOM sanitizer, add fetch() URL scheme validation, add Content-Type validation, add execution timeout, and block `data:` URI navigation. ~1,400 new lines, 10 files to create/modify, ~80 new tests.

## Critical Findings (from audit)

| Finding | Severity | Current Status |
|---------|----------|---------------|
| CSP modules implemented but never wired | CRITICAL | 8 modules orphaned |
| No HTML/DOM sanitizer | CRITICAL | Missing entirely |
| Fetch API has zero URL scheme validation | CRITICAL | Wide open |
| `data:` URI navigation allowed | HIGH | Design gap |
| No Content-Type validation | HIGH | Missing |
| No request header sanitization | HIGH | Missing |
| No execution timeout in interpreter | HIGH | Missing |
| No HTML entity encoding in rendering | MEDIUM | Only in one UI component |

## Architecture

### Current (broken) chain:
```
Address Bar → UrlParser (blocks javascript:/vbscript:)
           → NavigationController (no guards wired)
           → RequestManager (blocks redirects)
           → HtmlParser (no sanitization)
           → TreeBuilder (no sanitization)
           → Interpreter (no CSP)
           → DOM
                                      ↘ fetch-api.ts (no validation at all)
```

### Required chain:
```
Address Bar → UrlParser (+ data: blocking)
           → NavigationController (+ CspNavigationGuard via adapter)
           → RequestManager (existing redirect checks)
           → HtmlParser → TreeBuilder (+ html-sanitizer post-processing)
           → Interpreter (+ execution timeout)
           → DOM
                                      ↘ fetch-api.ts (+ CspResourceEnforcer + scheme validation)
```

## Implementation Plan

### Step 1: HTML Sanitizer (`src/browser/security/html-sanitizer.ts`) — NEW

Simple DOM-based sanitizer that strips dangerous elements/attributes after tree building.

**Design:**
- Takes a `DomNode` tree root, walks it, removes `<script>`, `<iframe>`, `<object>`, `<embed>`, `<applet>`, `<base>`, `<form>` elements
- Strips `on*` event handler attributes (onclick, onerror, etc.)
- Strips `javascript:` URLs from href/src/action attributes
- Configurable allowlist (default: strip dangerous, keep safe)
- Exports `sanitizeHtmlTree(root, config?)` and `HtmlSanitizerConfig` type

**Allowed by default:** `<a>`, `<img>`, `<div>`, `<span>`, `<p>`, `<table>`, `<form>`, etc. (all non-script elements)
**Stripped elements:** `<script>`, `<iframe>`, `<object>`, `<embed>`, `<applet>`, `<base>`
**Stripped attributes:** All `on*` handlers, `javascript:` URLs in href/src/action/formaction

**Integration point:** Called in `page-renderer.ts` after `HtmlParser.parse()` completes, before script execution.

### Step 2: CSP Adapter (`src/browser/security/csp-guard-adapter.ts`) — NEW

Bridges `CspNavigationGuard` to `INavigationGuard` interface.

**Design:**
- Wraps `CspNavigationGuard`, adds `readonly name: string = 'csp'`
- Maps `NavigationRequest` → `CspNavigationRequest` (type mapping: NavigationType → string)
- `canNavigate()` calls `guard.canNavigate()`, returns boolean
- `blockedReason()` returns the CSP violation reason

### Step 3: CSP Enforcement Layer (`src/browser/security/csp-enforcement.ts`) — NEW

Central orchestrator that instantiates and wires all CSP modules.

**Design:**
- Exports `createCspEnforcement()` factory
- Returns `{ policyStore, reporter, navigationGuard, resourceEnforcer, scriptEnforcer }`
- NavigationGuard is wrapped in the adapter for `INavigationGuard` compatibility
- Used by `main.ts` and `page-renderer.ts`

### Step 4: Fetch API Hardening (`src/browser/js/fetch-api.ts`) — MODIFY

Add URL scheme validation and CSP connect-src enforcement inside `createFetchFn`.

**Changes:**
- Before calling platform fetch, validate URL scheme: block `javascript:`, `vbscript:`, `data:` (configurable)
- Accept optional `resourceEnforcer?: CspResourceEnforcer` parameter
- If resourceEnforcer provided, call `checkFetch()` before proceeding
- Reject with `TypeError` if blocked

### Step 5: Interpreter Execution Timeout (`src/browser/js/interpreter.ts`) — MODIFY

Add configurable max execution time to prevent infinite loops.

**Design:**
- Add `maxExecutionMs: number` option (default: 5000ms)
- Track `startTime` at beginning of `run()`
- Check elapsed time at loop iteration boundaries (every N operations)
- Throw `JSError('Script execution timed out', 'TimeoutError')` if exceeded
- Counter: track operation count, check every 1000 ops to avoid per-op overhead

### Step 6: Block `data:` URI Navigation (`src/browser/navigation/url-parser.ts`) — MODIFY

Add `data:` to `BLOCKED_PROTOCOLS` set.

**Change:** In `url-parser.ts`, add `'data:'` to `BLOCKED_PROTOCOLS`. Keep `data:` in `ALLOWED_PROTOCOLS` for internal rendering (e.g., `<img src="data:...">`), but block address-bar navigation to `data:` URIs.

### Step 7: Content-Type Validation (`src/browser/networking/request-manager.ts`) — MODIFY

Validate Content-Type on responses.

**Changes:**
- After receiving response, check `content-type` header
- If `X-Content-Type-Options: nosniff` is set, enforce strict MIME checking
- Block `text/html` responses served as `application/json` (MIME sniffing protection)
- Add `contentSniffingBlocked` field to `PageLoadResult`

### Step 8: Request Header Sanitization (`src/browser/js/fetch-api.ts`) — MODIFY

Sanitize request headers in `Headers` class.

**Changes:**
- In `Headers.set()` and `Headers.append()`, validate header names:
  - Block `Host` header (must be set by the platform, not by JS)
  - Block `Content-Length` (set by the platform)
  - Block `Connection`, `Transfer-Encoding` (HTTP/1.1 framing headers)
- Throw `TypeError` if restricted header is set from JS

### Step 9: Wire CSP into Pipeline (`src/browser/main.ts`) — MODIFY

Instantiate CSP enforcement and wire it into the navigation controller and page renderer.

**Changes:**
- Import `createCspEnforcement`
- Create enforcement instance
- Add `cspNavigationGuard` to navigation controller via `addGuard()`
- Pass `resourceEnforcer` and `scriptEnforcer` to page renderer
- Pass `resourceEnforcer` to `createGlobalEnv()` as `platformFetch` wrapper

### Step 10: Tests (`tests/xss-mitigations.test.ts`) — NEW

Comprehensive test suite covering all mitigation layers.

**Test categories (~80 tests):**
1. HTML sanitizer — dangerous element stripping, attribute stripping, URL sanitization, config
2. CSP guard adapter — NavigationRequest mapping, canNavigate, blockedReason
3. Fetch URL scheme blocking — javascript:, data:, vbscript: rejection
4. Fetch CSP enforcement — connect-src blocking, policy evaluation
5. Header sanitization — Host/Content-Length blocking
6. Execution timeout — infinite loop detection, configurable timeout
7. data: URI blocking — address bar navigation blocked
8. Content-Type validation — MIME sniffing protection
9. Integration — full pipeline CSP enforcement

## Files Summary

| File | Action | Est. Lines |
|------|--------|-----------|
| `src/browser/security/html-sanitizer.ts` | CREATE | ~200 |
| `src/browser/security/csp-guard-adapter.ts` | CREATE | ~60 |
| `src/browser/security/csp-enforcement.ts` | CREATE | ~80 |
| `src/browser/js/fetch-api.ts` | MODIFY | +40 (scheme validation + header sanitization) |
| `src/browser/js/interpreter.ts` | MODIFY | +30 (execution timeout) |
| `src/browser/navigation/url-parser.ts` | MODIFY | +1 (block data:) |
| `src/browser/networking/request-manager.ts` | MODIFY | +20 (Content-Type validation) |
| `src/browser/main.ts` | MODIFY | +15 (wire CSP) |
| `tests/xss-mitigations.test.ts` | CREATE | ~600 (80 tests) |
| `doc/xss-mitigations.md` | CREATE | ~100 |

**Estimated total:** ~1,146 new lines, ~107 modified lines
