/**
 * @file src/platform/shared/node-builtin-shims/util.ts
 *
 * CJS shim for `util`. Bundled libraries that `require('util')` resolve here
 * instead of the empty `__vite-browser-external` shim. In the packaged
 * Electron build the real Node util is returned; in a plain browser a minimal
 * fallback (inherits/promisify/format) keeps bundled libs loadable.
 */
import { loadNodeBuiltin } from './loader';

const realUtil = loadNodeBuiltin('util');
const fallbackUtil = {
  inherits: (ctor: unknown, superCtor: unknown): void => {
    if (ctor && superCtor && typeof ctor === 'function' && typeof superCtor === 'function') {
      Object.setPrototypeOf(ctor.prototype, superCtor.prototype);
      (ctor as { super_?: unknown }).super_ = superCtor;
    }
  },
  promisify: <T>(fn: (...args: unknown[]) => void): ((...args: never[]) => Promise<T>) => {
    return function promisified(this: unknown, ...args: never[]): Promise<T> {
      return new Promise<T>((resolve, reject) => {
        fn.call(this, ...args, (err: unknown, ...result: T[]) => {
          if (err) reject(err);
          else resolve(result.length > 1 ? (result as unknown as T) : result[0]!);
        });
      });
    };
  },
  format: (fmt: string, ...args: unknown[]): string => {
    if (!fmt) return args.map(String).join(' ');
    return fmt.replace(/%[sdj%]/g, (m) => {
      if (m === '%%') return '%';
      return String(args.shift() ?? '');
    });
  },
  isArray: Array.isArray,
  isString: (v: unknown): v is string => typeof v === 'string',
  isBuffer: (v: unknown): boolean => typeof Buffer !== 'undefined' && Buffer.isBuffer(v),
};
export = realUtil ?? fallbackUtil;
