/**
 * @file src/browser/networking/node-builtins.ts
 *
 * Lazy-loads Node.js built-in modules at runtime.
 *
 * Vite/Rolldown externalizes `import('node:*')` to `__vite-browser-external` —
 * an empty shim — so dynamic imports of Node builtins silently break inside the
 * packaged Electron build (`net.connect` becomes `p.connect is not a function`).
 * The Electron renderer has `nodeIntegration: true`, so the CommonJS `require`
 * global is available and returns the real module. In a plain browser `require`
 * is absent and this returns `null` (callers throw or fall back).
 */

export function loadNodeBuiltin<T = unknown>(name: string): T | null {
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
