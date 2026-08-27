/**
 * @file src/browser/networking/node-builtins.ts
 *
 * Lazy-loads Node.js built-in modules at runtime.
 *
 * When contextIsolation is enabled the renderer has no direct `require()`.
 * This module first tries the preload-bridge (`window.nova.require`) and
 * falls back to the legacy global `require` for environments that still use
 * nodeIntegration.
 */

export function loadNodeBuiltin<T = unknown>(name: string): T | null {
  // contextIsolation path — preload bridge
  const nova = (globalThis as { nova?: { require: (n: string) => unknown } }).nova;
  if (nova && typeof nova.require === 'function') {
    try {
      return nova.require(name) as T;
    } catch {
      return null;
    }
  }

  // Legacy nodeIntegration path
  if (typeof require === 'function') {
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      return require(name) as T;
    } catch {
      return null;
    }
  }
  return null;
}
