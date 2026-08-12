/**
 * @file src/platform/shared/node-builtin-shims/loader.ts
 *
 * Shared loader for the Node built-in shims used by bundled CJS libraries
 * (pngjs) that statically `require('zlib' | 'buffer' | ...)`.
 *
 * Vite/Rolldown externalizes these bare builtins to `__vite-browser-external`
 * (an empty shim), silently breaking bundled Node libraries in the packaged
 * Electron build. The Electron renderer has `nodeIntegration: true`, so the
 * CommonJS `require` global is available and returns the real module. In a
 * plain browser `require` is absent and this returns `null`; consumers then
 * degrade gracefully (e.g. PNG decode falls back to a placeholder).
 */

import { loadNodeBuiltin } from '../../../browser/networking/node-builtins';

export { loadNodeBuiltin };

export function loadNodeBuiltinOrDefault<T = unknown>(name: string, fallback: T): T {
  return loadNodeBuiltin<T>(name) ?? fallback;
}
