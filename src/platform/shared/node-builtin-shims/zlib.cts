/**
 * @file src/platform/shared/node-builtin-shims/zlib.ts
 *
 * CJS shim for `zlib`. Bundled libraries that `require('zlib')` resolve here
 * instead of the empty `__vite-browser-external` shim. In the packaged
 * Electron build the real Node zlib is returned.
 *
 * Under `contextIsolation`, real Node zlib is bridged in from the preload's
 * allowlisted `require` (see electron/preload.cjs). Its plain data functions
 * (`inflateSync` et al.) survive contextBridge cloning fine — but its
 * streaming classes do not, because contextBridge doesn't preserve prototype
 * chains. pngjs's sync PNG decode (`lib/sync-inflate.js`) does
 * `util.inherits(Inflate, zlib.Inflate)` and then calls `this.on(...)` on the
 * result, which crashes once `zlib.Inflate.prototype` arrives across the
 * bridge without its EventEmitter methods. The fallback below keeps the
 * (working) bridged `inflateSync` as the real decompressor, but wraps it in a
 * same-realm `Inflate` stand-in — constructed locally, so its prototype chain
 * is intact — that drains one up-front `inflateSync()` call through the
 * chunked `_handle.writeSync()` interface pngjs's sync path expects.
 */
import { loadNodeBuiltin } from './loader';

interface NodeZlibLike {
  inflateSync: (buf: Uint8Array) => Uint8Array;
  Inflate?: unknown;
  Z_MIN_CHUNK?: number;
  Z_FINISH?: number;
}

const realZlib = loadNodeBuiltin<NodeZlibLike>('zlib');

function hasWorkingInflateClass(z: NodeZlibLike): boolean {
  const ctor = z.Inflate as { prototype?: { on?: unknown } } | undefined;
  return typeof z.Inflate === 'function' && typeof ctor?.prototype?.on === 'function';
}

interface SyncSlot {
  writeSync(flushFlag: number, chunk: Uint8Array, inOff: number, availIn: number, outBuf: Uint8Array, outOff: number, availOut: number): [number, number];
  close(): void;
}

function makeSyncInflateHandle(inflateSync: (buf: Uint8Array) => Uint8Array): SyncSlot {
  let output: Uint8Array | null = null;
  let outPos = 0;
  return {
    writeSync(_flushFlag, chunk, inOff, availIn, outBuf, outOff, availOut) {
      if (output === null) {
        output = inflateSync(chunk.subarray(inOff, inOff + availIn));
        outPos = 0;
      }
      const n = Math.min(availOut, output.length - outPos);
      outBuf.set(output.subarray(outPos, outPos + n), outOff);
      outPos += n;
      return [0, availOut - n];
    },
    close() {},
  };
}

function buildFallbackZlib(inflateSync: (buf: Uint8Array) => Uint8Array) {
  function Inflate(this: Record<string, unknown>, opts?: { chunkSize?: number }): void {
    this._handle = makeSyncInflateHandle(inflateSync);
    this._chunkSize = (opts && opts.chunkSize) || 16 * 1024;
    this._offset = 0;
    this._buffer = new Uint8Array(this._chunkSize as number);
    this._hadError = false;
  }
  type Listeners = Record<string, Array<(...a: unknown[]) => void>>;
  Inflate.prototype.on = function (this: { _listeners?: Listeners }, evt: string, fn: (...a: unknown[]) => void) {
    const listeners = (this._listeners ??= {});
    (listeners[evt] ??= []).push(fn);
    return this;
  };
  Inflate.prototype.emit = function (this: { _listeners?: Listeners }, evt: string, ...args: unknown[]) {
    for (const fn of this._listeners?.[evt] ?? []) fn(...args);
    return true;
  };

  return { Inflate, Z_MIN_CHUNK: 64, Z_FINISH: 4 };
}

const zlib = !realZlib
  ? null
  : hasWorkingInflateClass(realZlib)
    ? realZlib
    : { ...realZlib, ...buildFallbackZlib((buf) => realZlib.inflateSync(buf)) };

export = zlib;
