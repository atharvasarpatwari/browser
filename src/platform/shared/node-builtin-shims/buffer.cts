/**
 * @file src/platform/shared/node-builtin-shims/buffer.ts
 *
 * CJS shim for `buffer`. Bundled libraries that `require('buffer')` resolve
 * here instead of the empty `__vite-browser-external` shim. In the packaged
 * Electron build the real Node Buffer is returned; in a plain browser it is
 * `null` and callers degrade gracefully.
 */
import { loadNodeBuiltin } from './loader';

const buffer = loadNodeBuiltin('buffer');
export = buffer;
