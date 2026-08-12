/**
 * @file src/platform/shared/node-builtin-shims/zlib.ts
 *
 * CJS shim for `zlib`. Bundled libraries that `require('zlib')` resolve here
 * instead of the empty `__vite-browser-external` shim. In the packaged
 * Electron build the real Node zlib is returned; in a plain browser it is
 * `null` and callers degrade gracefully.
 */
import { loadNodeBuiltin } from './loader';

const zlib = loadNodeBuiltin('zlib');
export = zlib;
