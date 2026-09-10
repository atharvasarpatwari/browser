/**
 * @file src/platform/shared/node-builtin-shims/buffer.ts
 *
 * CJS shim for `buffer`. Bundled libraries that `require('buffer')` resolve
 * here instead of the empty `__vite-browser-external` shim. In the packaged
 * Electron build the real Node Buffer is returned; under `contextIsolation`
 * (no bridged Node `buffer` — see preload.cjs) it falls back to the
 * page-world `Buffer` polyfill installed by installBufferPolyfill(), so
 * consumers like pngjs's `require("buffer").Buffer`/`.kMaxLength` never see
 * `null`.
 */
import { loadNodeBuiltin } from './loader';

const nodeBuffer = loadNodeBuiltin<{ Buffer: unknown; kMaxLength: number }>('buffer');
const buffer = nodeBuffer ?? {
  Buffer: (globalThis as { Buffer?: unknown }).Buffer,
  kMaxLength: 0x7fffffff,
};
export = buffer;
