# Vite Dev Server Setup

**Date:** 2026-07-22
**Session:** Added Vite dev server for live UI testing
**Status:** Completed

---

## Summary

Added a Vite dev server to enable live UI testing in a browser at `http://localhost:5173`. The entire Nova browser chrome UI (tabs, address bar, toolbar, bookmarks, settings) is now testable interactively.

## Root Causes

### 1. No dev server or bundler
**Problem:** `package.json` had no `dev` script. The project only had `tsc` for compilation, which produces Node-targeted output, not browser-runnable code.
**Fix:** Added `"dev": "vite"` script and `vite.config.ts` with proper ESM config.

### 2. `Buffer.byteLength()` in IPC transport
**Problem:** `src/common/ipc/transport.ts` used Node.js `Buffer` global (3 occurrences at lines 145, 146, 249) which doesn't exist in browsers.
**Fix:** Replaced with `new TextEncoder().encode(data).byteLength` — browser-native and accurate for UTF-8.

### 3. Node.js-only image decoders at top-level import
**Problem:** `src/browser/image/decoder.ts` had top-level `import { PNG } from 'pngjs'` and `import * as jpeg from 'jpeg-js'`. `pngjs` depends on Node.js `zlib` and crashes in browsers.
**Fix:** Changed to type-only imports + dynamic `await import()` inside each decode method. `decode()` method became async. Updated caller in `lazy-loader.ts` to `await`.

### 4. `electron` dynamic import resolution
**Problem:** `src/platform/shared/runtime-adapter.ts` has `await import('electron')` which Vite tries to resolve at build time.
**Fix:** Added `resolve.alias` mapping `electron` to an empty data-URL module.

## Files Modified

| File | Change |
|------|--------|
| `index.html` (new) | Root entry point for Vite dev server |
| `vite.config.ts` (new) | Vite config with electron alias, port 5173 |
| `package.json` | Added `"dev": "vite"` script |
| `src/common/ipc/transport.ts` | `Buffer.byteLength()` → `TextEncoder` (3 occurrences) |
| `src/browser/image/decoder.ts` | Top-level imports → lazy dynamic imports; `decode()` → async |
| `src/browser/rendering/lazy-loader.ts` | Added `await` to `decoder.decode()` call |

## Files Created

| File | Purpose |
|------|---------|
| `scripts/JIT compilation (if building from scratch — very advanced).c` | Reference x86-64 JIT compiler for stack-based bytecode |

## Test Results

```
navigation-bridge.test.ts: 25/25 passed
tab-strip.test.ts:        14/14 passed
```

## How to Use

```bash
npm run dev
# Opens at http://localhost:5173
```

The full browser chrome UI loads with tabs, address bar, toolbar, bookmark bar, status bar, and settings. All 8 UI fixes from today's session are visible and testable.
