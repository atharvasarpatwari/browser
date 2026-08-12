/**
 * @file src/platform/shared/node-builtin-shims/assert.ts
 *
 * CJS shim for `assert`. Bundled libraries that `require('assert')` resolve
 * here instead of the empty `__vite-browser-external` shim. In the packaged
 * Electron build the real Node assert is returned; in a plain browser a
 * minimal `.ok` fallback is provided.
 */
import { loadNodeBuiltin } from './loader';

const assert = loadNodeBuiltin('assert') ?? {
  ok(value: unknown, message?: string): void {
    if (!value) throw new Error(message ?? 'Assertion failed');
  },
  strictEqual(actual: unknown, expected: unknown, message?: string): void {
    if (actual !== expected) throw new Error(message ?? `Expected ${expected}, got ${actual}`);
  },
};
export = assert;
