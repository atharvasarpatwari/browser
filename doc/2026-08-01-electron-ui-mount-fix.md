# Electron UI Mount Fix — Vite Node-Builtin Externalization

**Date:** 2026-08-01
**Session:** Fix blank Electron window by resolving Vite "Module fs has been externalized" renderer crash
**Status:** Completed

---

## Summary
The Electron "Nova Browser" window rendered blank because the renderer crashed during module evaluation with Vite's `Module "fs" has been externalized for browser compatibility` error. Vite hoists **static named imports** of Node builtins to module scope as property accesses on an externalized-module Proxy, and any access throws. Two modules in the `main.ts` graph did this: `crash-reporter.ts` (fs/path/crypto) and `web-apis.ts` (node:crypto). Converted both to lazy `require()` inside try/catch (the pattern `local-storage.ts` already used successfully). The UI now mounts: tab bar, address bar, bookmark bar, 13 buttons, 0 console/page errors.

## Root Causes
### 1. crash-reporter.ts static fs/path/crypto imports
**File:** `src/browser/engine/crash-reporter.ts` (imported by `src/app/main.ts:45`)
**Problem:** `import { writeFileSync, mkdirSync, ... } from 'fs'` was transformed by Vite to a hoisted
```js
const writeFileSync = __vite__cjsImport1_fs["writeFileSync"];
```
at module scope. The externalized `fs` Proxy's `get` trap throws immediately:
```
Error: Module "fs" has been externalized for browser compatibility. Cannot access "fs.writeFileSync" in client code.
    at Object.get (http://localhost:5173/@id/__vite-browser-external:fs:3:11)
    at .../src/browser/engine/crash-reporter.ts:1:44
```
**Fix:** Removed the three static imports and lazily `require` the builtins inside the try blocks that already guarded the only usages (`writeMinidump`, `deleteMinidump`). In Node the `require` works; in the browser `require` is undefined → ReferenceError → caught → minidump write degrades to `undefined`, exactly like `local-storage.ts`'s `DiskStorageBackend`:
```ts
writeMinidump(report: CrashReport, data: Buffer): MinidumpFile | undefined {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const fs = require('node:fs') as typeof import('node:fs');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const path = require('node:path') as typeof import('node:path');
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { randomUUID } = require('node:crypto') as typeof import('node:crypto');
    ...
```
`deleteMinidump` similarly requires `node:fs` before its `unlinkSync`. `readdirSync`/`readFileSync` were imported but unused — dropped.

### 2. web-apis.ts static node:crypto import
**File:** `src/browser/js/web-apis.ts` (reached via `main.ts` → `page-renderer.ts:50` `runJS` → `js/index` → `web-apis`)
**Problem:** After fixing #1, the same trap fired for `node:crypto.randomBytes` at module scope.
**Fix:** Replaced the static import with two browser-safe helpers that try Node crypto first and fall back to the Web Crypto API:
```ts
function getRandomBytes(len: number): Uint8Array {
  try {
    const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
    return nodeCrypto.randomBytes(len);
  } catch {
    const out = new Uint8Array(len);
    globalThis.crypto.getRandomValues(out);
    return out;
  }
}

function getRandomUUID(): string {
  try {
    const nodeCrypto = require('node:crypto') as typeof import('node:crypto');
    return nodeCrypto.randomUUID();
  } catch {
    if (typeof globalThis.crypto?.randomUUID === 'function') {
      return globalThis.crypto.randomUUID();
    }
    // RFC 4122 v4 fallback via getRandomValues
    ...
  }
}
```
Call sites updated: `crypto.getRandomValues` → `getRandomBytes`, `crypto.randomUUID` → `getRandomUUID`.

## Files Modified
| File | Change |
|------|--------|
| `src/browser/engine/crash-reporter.ts` | Removed static `crypto`/`fs`/`path` imports; lazy `require` inside `writeMinidump`/`deleteMinidump` try blocks |
| `src/browser/js/web-apis.ts` | Removed static `node:crypto` import; added `getRandomBytes`/`getRandomUUID` helpers with Web Crypto fallback; updated call sites |

## Test Results
```
$ npx vitest run tests/crash-recovery.test.ts
  tests/crash-recovery.test.ts (88 tests) 640ms
  Test Files  1 passed (1)
       Tests  88 passed (88)

$ npx vitest run tests/web-apis.test.ts tests/crash-recovery.test.ts
  Test Files  2 passed (2)
       Tests  175 passed (175)

$ npx vitest run tests/local-storage.test.ts tests/web-storage-bindings.test.ts tests/indexed-db.test.ts tests/preload.test.ts
  Test Files  4 passed (4)
       Tests  107 passed (107)

$ npx tsc --noEmit
  (10 pre-existing errors in src/browser/js/{interpreter,values,vm,web-apis,websocket-api}.ts — verified identical on git HEAD; no new errors introduced)
```

## Verification Steps
1. Playwright headless check of `http://localhost:5173` (`C:\Users\athar\AppData\Local\Temp\opencode\ui-check.cjs`):
   - Before fix: `browserApp: false`, `bodyChildren: 1`, 1 pageerror (`fs` externalized).
   - After fix: `browserApp: true`, `tabCount: 1`, `addressBar: 2`, `bookmarkBar: 1`, `buttons: 13`, `ERRORS: 0`.
2. Restarted `npm run electron:dev` (killed all electron processes first); window "Nova Browser" (pid 9076) launched.
3. Screenshot of the Electron window captured to `C:\Users\athar\AppData\Local\Temp\opencode\nova-shot2.png` (1280×800) for user visual confirmation.

## Notes
- `git diff` scoped to the two files above; `git stash` round-trip confirmed the 10 `tsc` errors pre-exist at HEAD (repo advanced past the earlier 0-error snapshot).
- The `src/browser/settings/*` modules also statically import `crypto` but are **not** imported from `main.ts` — they did not block the mount.
